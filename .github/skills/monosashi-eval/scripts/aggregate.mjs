// Stage 4 (§4 S4, §7 集計): mechanically aggregate criterion scores into a scoreboard.
// Deterministic. Handles: track/domain radar, N/A exclusion, optional weighted single
// index (external|internal posture), M2 divergence as an independent flag, and a
// two-pass reconciliation diff (independent 2 passes突合).
//
// Usage:
//   node aggregate.mjs --passA passA.toon --passB passB.toon --plan plan.toon --weighting internal   (preferred)
//   node aggregate.mjs <input.toon> [external|internal]
//   cat input.toon | node aggregate.mjs - internal
// Pass --plan plan.toon to surface the mechanical M2 flag (computed by select-tracks).
// Pass --evidence evidence.toon to resolve passes' evidenceRefs into {path,snippet} in the
// scoreboard's mergedScores (the report becomes self-contained; passes stay token-cheap).
// Input shape: { passA: ScorePass, passB?: ScorePass, weighting?: "external"|"internal" }
//   (a bare ScorePass is also accepted and treated as passA.)
// Prefer --passA/--passB (separate files): passing large combined TOON as a single
// positional arg can exceed the OS arg-length limit and silently truncate.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RUBRIC, WEIGHT_PROFILES } from "./rubric.mjs";
import { indexPack, resolveScoreEvidence } from "./evidence-util.mjs";
import { normalizePass, normalizePack } from "./normalize.mjs";
import { cliOk, runCli } from "./cli.mjs";
import { readToonFile, toonParse, toonStringify } from "./serde.mjs";
import { argRunId, makeProvenance, readToolVersion } from "./provenance.mjs";
function readInput(arg) {
    if (!arg || arg === "-")
        return readFileSync(0, "utf8");
    return readFileSync(arg, "utf8");
}
const CRITERION_INDEX = new Map(RUBRIC.tracks.flatMap((t) => t.criteria.map((c) => [c.id, c])));
function isNum(s) {
    return typeof s === "number";
}
/** Build the per-criterion audit trail from the reconciled scores. Pure. */
export function buildAudit(scores, reviewCriteria) {
    const trail = [];
    for (const s of scores) {
        if (s.criterion === "M2")
            continue; // M2 is the mechanical flag, audited via plan.m2.basis
        const judgements = [];
        if (s.scoreA !== undefined)
            judgements.push({ pass: "A", score: s.scoreA, confidence: s.confidenceA ?? s.confidence });
        if (s.scoreB !== undefined)
            judgements.push({ pass: "B", score: s.scoreB, confidence: s.confidenceB ?? s.confidence });
        if (s.scoreC !== undefined)
            judgements.push({ pass: "C", score: s.scoreC, confidence: s.confidenceC ?? s.confidence });
        // No per-pass breakdown recorded (single-judgement criterion or an N/A passthrough): the
        // merged entry *is* the sole pass-A judgement.
        if (judgements.length === 0)
            judgements.push({ pass: "A", score: s.score, confidence: s.confidence });
        // mean/median only when BOTH passes were numeric; an N/A from either side is a passthrough
        // (the merged score is the numeric side or N/A, not an average) even though both passes ran.
        const mergedAB = isNum(s.scoreA ?? "N/A") && isNum(s.scoreB ?? "N/A");
        const method = mergedAB && s.scoreC !== undefined ? "median(A,B,C)"
            : mergedAB ? "mean(A,B)"
                : s.scoreB !== undefined ? "N/A passthrough"
                    : !isNum(s.score) && judgements.length === 1 ? "N/A passthrough"
                        : "single (A)";
        trail.push({
            criterion: s.criterion,
            track: CRITERION_INDEX.get(s.criterion)?.track ?? "?",
            finalScore: s.score,
            confidence: s.confidence,
            method,
            judgements,
            evidence: (s.evidence ?? []).map((e) => (e.lines != null ? { path: e.path, lines: e.lines } : { path: e.path })),
            needsHumanReview: reviewCriteria.has(s.criterion),
        });
    }
    return trail;
}
/** Mean of numeric scores, or null if none. */
function mean(nums) {
    if (nums.length === 0)
        return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}
/** Median of numeric scores (robust tie-break for 3 passes). */
function median(nums) {
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
const CONF_RANK = { low: 0, medium: 1, high: 2 };
/** Merge two passes' confidence by *score agreement*, not label-equality.
 *  Big score disagreement (diff>=2, also needsHumanReview) -> low. Otherwise the
 *  lower of the two labels, capped at "medium" when scores differ by one. Equal
 *  scores keep the (lower) shared label, so consensus is no longer demoted to low
 *  just because the two passes attached different confidence words. */
function mergeConfidence(a, b, diff) {
    if (diff >= 2)
        return "low";
    const lo = (CONF_RANK[a] ?? 0) <= (CONF_RANK[b] ?? 0) ? a : b;
    if (diff >= 1 && (CONF_RANK[lo] ?? 0) > 1)
        return "medium";
    return lo;
}
/** Reconcile passes per criterion (§7 整合パス). With only A,B the merged score is the
 *  mean of the two; when an optional tie-break pass C covers a (contested) criterion the
 *  merged score becomes the **median of {A,B,C}** — a robust resolver for the ±1 boundary
 *  drift that L targets. needsHumanReview flags criteria whose range across the available
 *  passes is still ≥2 (genuine high variance survives even the tie-break). */
function reconcile(a, b, c) {
    const bById = new Map(b.scores.map((s) => [s.criterion, s]));
    const cById = new Map((c?.scores ?? []).map((s) => [s.criterion, s]));
    const merged = [];
    const flags = [];
    let agree = 0;
    let compared = 0;
    let tieBroken = 0;
    let singlePass = 0;
    for (const sa of a.scores) {
        const sb = bById.get(sa.criterion);
        if (!sb) {
            // Pass B (the targeted second opinion) skipped this criterion — A was high-confidence,
            // so it stands as a single judgement (§7 second-opinion mode). Mark it for the report.
            merged.push({ ...sa, singlePass: true });
            singlePass++;
            continue;
        }
        bById.delete(sa.criterion);
        const sc = cById.get(sa.criterion);
        // N/A handling: if both N/A -> N/A; if one N/A -> divergence flag, keep numeric one.
        // Either way BOTH passes judged this criterion, so carry the per-pass breakdown
        // (scoreA/scoreB incl. "N/A"). Without it the report's pass column and the audit trail
        // lose the second opinion and fall back to the "A·/B·" placeholder as if B never ran.
        const perPass = {
            scoreA: sa.score,
            scoreB: sb.score,
            confidenceA: sa.confidence,
            confidenceB: sb.confidence,
        };
        if (!isNum(sa.score) && !isNum(sb.score)) {
            merged.push({ ...sa, ...perPass });
            continue;
        }
        if (!isNum(sa.score) || !isNum(sb.score)) {
            flags.push({ criterion: sa.criterion, passA: sa.score, passB: sb.score, diff: NaN });
            merged.push({ ...(isNum(sa.score) ? sa : sb), ...perPass });
            continue;
        }
        compared++;
        const diffAB = Math.abs(sa.score - sb.score);
        if (diffAB === 0)
            agree++;
        // Available numeric scores across A, B, and (if it covered this criterion) C.
        const nums = [sa.score, sb.score];
        const hasC = sc !== undefined && isNum(sc.score);
        if (hasC)
            nums.push(sc.score);
        const usedTieBreak = nums.length === 3;
        if (usedTieBreak)
            tieBroken++;
        const range = Math.max(...nums) - Math.min(...nums);
        if (range >= 2) {
            flags.push({ criterion: sa.criterion, passA: sa.score, passB: sb.score, passC: sc?.score, diff: range });
        }
        const mergedScore = usedTieBreak ? median(nums) : (sa.score + sb.score) / 2;
        // Confidence merged by *score spread* across the available passes (not label-equality).
        merged.push({
            ...sa,
            score: round2(mergedScore),
            scoreA: sa.score,
            scoreB: sb.score,
            ...(hasC ? { scoreC: sc.score } : {}),
            confidence: mergeConfidence(sa.confidence, sb.confidence, range),
            confidenceA: sa.confidence,
            confidenceB: sb.confidence,
            ...(sc ? { confidenceC: sc.confidence } : {}),
            rationale: usedTieBreak
                ? `パスA=${sa.score}・パスB=${sb.score}・パスC=${sc.score} の中央値 → ${round2(mergedScore)}。${sa.rationale}`
                : `パスA=${sa.score}・パスB=${sb.score} の平均 → ${round2(mergedScore)}。${sa.rationale}`,
        });
    }
    // Criteria only present in B (B-only; rare in second-opinion mode). Single judgement too.
    for (const sb of bById.values()) {
        merged.push({ ...sb, singlePass: true });
        singlePass++;
    }
    return {
        pass: { merged, flags },
        stats: {
            comparedNumeric: compared,
            exactAgreement: compared ? round2(agree / compared) : null,
            needsHumanReview: flags.length,
            tieBroken,
            singlePass,
        },
    };
}
/** Resolve a merged score's `evidenceRefs` into concrete {path, snippet} citations for the
 *  report (the verbatim snippet lives in the pack, not in every pass). Inline evidence is
 *  preserved; `evidenceRefs` is kept alongside for audit. No-op when the score has no refs. */
function attachResolvedEvidence(s, packIndex) {
    if (!Array.isArray(s.evidenceRefs) || s.evidenceRefs.length === 0)
        return s;
    const { resolved } = resolveScoreEvidence(s, packIndex);
    return { ...s, evidence: resolved.map(({ path, snippet, lines }) => (lines != null ? { path, snippet, lines } : { path, snippet })) };
}
function weightFor(def, weighting) {
    if (!weighting)
        return 1;
    const prof = WEIGHT_PROFILES[weighting];
    // Multiple tags -> take the strongest multiplier.
    let w = 1;
    for (const tag of def.tags) {
        const m = prof[tag];
        if (m && m > w)
            w = m;
    }
    return w;
}
function summarize(scores, weighting, m2FromPlan) {
    // Per-track radar averages (excluding N/A and M2).
    const byTrack = {};
    // Per-domain (tag) averages.
    const byTag = {};
    // Confidence breakdown.
    const confidence = { high: 0, medium: 0, low: 0 };
    let naCount = 0;
    let wSum = 0;
    let wScoreSum = 0;
    for (const s of scores) {
        const def = CRITERION_INDEX.get(s.criterion);
        if (s.confidence in confidence)
            confidence[s.confidence]++;
        if (s.criterion === "M2") {
            // M2 is mechanical now (plan.m2); a stray legacy pass-M2 is ignored, never averaged.
            continue;
        }
        if (!isNum(s.score)) {
            naCount++;
            continue;
        }
        const track = def?.track ?? "?";
        (byTrack[track] ??= []).push(s.score);
        for (const tag of def?.tags ?? [])
            (byTag[tag] ??= []).push(s.score);
        const w = weightFor(def ?? { tags: [] }, weighting);
        wSum += w;
        wScoreSum += w * s.score;
    }
    const radarByTrack = Object.fromEntries(Object.entries(byTrack).map(([k, v]) => [k, { mean: round2(mean(v)), n: v.length }]));
    const radarByDomain = Object.fromEntries(Object.entries(byTag).map(([k, v]) => [k, { mean: round2(mean(v)), n: v.length }]));
    const allNumeric = scores.filter((s) => s.criterion !== "M2" && isNum(s.score));
    const overallMean = allNumeric.length ? round2(mean(allNumeric.map((s) => s.score))) : null;
    const weightedIndex = weighting && wSum ? round2(wScoreSum / wSum) : null;
    return {
        radarByTrack,
        radarByDomain,
        overallMean,
        weighting: weighting ?? "none (unweighted)",
        weightedIndex,
        confidence,
        naCount,
        m2Flag: m2FromPlan
            ? {
                score: m2FromPlan.score,
                divergent: m2FromPlan.divergent,
                severity: m2FromPlan.severity,
                rationale: m2FromPlan.rationale,
                mechanical: true,
                basis: m2FromPlan.basis,
            }
            : {
                score: "not derived",
                note: "plan.m2 が渡されていません。aggregate に --plan <plan.toon> を渡して機械算出 M2 を併記すること。",
            },
    };
}
/** Parse argv: supports `--passA f --passB f --weighting w`, a single positional input
 *  file (combined {passA,passB?} or a bare ScorePass), `-` for stdin, and a positional
 *  `external|internal`. Per-pass files are preferred — they avoid the OS arg-length
 *  limit that truncates large inline TOON. */
function parseArgs(argv) {
    const opt = { input: null, weighting: null, passA: null, passB: null, passC: null, plan: null, evidence: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--passA")
            opt.passA = argv[++i];
        else if (a === "--passB")
            opt.passB = argv[++i];
        else if (a === "--passC")
            opt.passC = argv[++i];
        else if (a === "--plan")
            opt.plan = argv[++i];
        else if (a === "--evidence")
            opt.evidence = argv[++i];
        else if (a === "--weighting")
            opt.weighting = argv[++i];
        else if (a === "external" || a === "internal")
            opt.weighting = a;
        else if (!opt.input)
            opt.input = a;
    }
    return opt;
}
/** Derive the M2 flag from a stray legacy pass-M2 score (pre-mechanical inputs only). */
function legacyM2(passA) {
    const legacy = passA.scores.find((s) => s.criterion === "M2");
    if (!legacy || !isNum(legacy.score))
        return null;
    return {
        criterion: "M2",
        score: legacy.score,
        divergent: legacy.score <= 2,
        severity: legacy.score <= 1 ? "HIGH — 宣言乖離が大きい" : legacy.score === 2 ? "LOW — 副成分が未宣言" : "ok",
        rationale: legacy.rationale,
        mechanical: true,
        basis: { declaredType: passA.declaredType ?? null, onStructuralAxes: [], declaredAxis: null },
    };
}
/**
 * Mechanically aggregate one to three scoring passes into a scoreboard. Pure — no IO. The LLM
 * passes and evidence pack are normalised first (LLM output drift: a string "3", "High"
 * confidence, a lower-cased id), so a stray surface form never silently drops a score from the
 * radar or skews reconciliation. Exported so the CLI `main()` and the unit tests share one path.
 */
export function aggregate(input, opts = {}) {
    const passA = normalizePass(input.passA).pass;
    const passB = input.passB ? normalizePass(input.passB).pass : undefined;
    const passC = input.passC ? normalizePass(input.passC).pass : undefined;
    const weighting = input.weighting ?? null;
    // Mechanical M2 travels in the plan (computed by select-tracks). Surface it as an independent
    // flag; fall back to a stray legacy pass-M2 only if no plan M2 was supplied.
    const m2FromPlan = opts.m2FromPlan ?? legacyM2(passA);
    let scores;
    let reconciliation = null;
    let reviewFlags = [];
    if (passB) {
        const r = reconcile(passA, passB, passC);
        scores = r.pass.merged;
        reconciliation = r.stats;
        reviewFlags = r.pass.flags;
    }
    else {
        // Pass B was skipped wholesale (second-opinion shouldRun=false: every pass-A criterion
        // was high-confidence). Each criterion stands as a single judgement — mark it so, exactly
        // as the per-criterion skip path does in reconcile(). Without this the report's pass column
        // sees no singlePass flag (and no scoreA/scoreB) and falls back to the "A·/B·" placeholder.
        scores = passA.scores.map((s) => ({ ...s, singlePass: true }));
    }
    const board = summarize(scores, weighting, m2FromPlan);
    // Re-attach concrete {path, snippet} citations to the report ONCE here, mechanically: passes
    // cite evidence by `evidenceRefs` (token-cheap), and the human-facing scoreboard resolves them
    // from the (normalised) pack so it is self-contained. Without a pack the refs are left as-is.
    const packIndex = opts.pack ? indexPack(normalizePack(opts.pack).pack) : null;
    const mergedScores = packIndex ? scores.map((s) => attachResolvedEvidence(s, packIndex)) : scores;
    // Audit trail (A5/H3): the judgement-provenance view, derived from the resolved merged scores
    // so its evidence citations match the report. The run header (runId/producedAt) is attached by
    // main() via provenance — this part is pure so the tests pin it deterministically.
    const reviewCriteria = new Set(reviewFlags.map((f) => f.criterion));
    const audit = {
        passes: { A: true, B: Boolean(passB), C: Boolean(passC) },
        trail: buildAudit(mergedScores, reviewCriteria),
    };
    return {
        target: passA.target,
        // Prefer the plan-derived declared type (m2FromPlan.basis) over the judge pass's echo: the
        // plan value is the deterministic, composite-aware inventory guess adopted in select-tracks,
        // so the report's declared type stays identical no matter which model profiled or judged.
        declaredType: m2FromPlan?.basis.declaredType ?? passA.declaredType ?? null,
        twoPass: Boolean(passB),
        tieBreak: passC ? { applied: true, criteria: passC.scores.map((s) => s.criterion) } : { applied: false },
        reconciliation,
        needsHumanReview: reviewFlags,
        scoreboard: board,
        mergedScores,
        audit,
    };
}
export function main(argv = process.argv.slice(2)) {
    const opt = parseArgs(argv);
    let input;
    if (opt.passA) {
        input = { passA: readToonFile(opt.passA) };
        if (opt.passB)
            input.passB = readToonFile(opt.passB);
        if (opt.passC)
            input.passC = readToonFile(opt.passC);
    }
    else {
        const raw = toonParse(readInput(opt.input ?? undefined));
        input = raw.passA ? raw : { passA: raw };
    }
    input.weighting = opt.weighting ?? input.weighting ?? undefined;
    const m2FromPlan = opt.plan
        ? readToonFile(opt.plan).m2 ?? null
        : null;
    const pack = opt.evidence
        ? readToonFile(opt.evidence)
        : null;
    const out = aggregate(input, { m2FromPlan, pack });
    // Stamp the run correlation ID (A5/H3): the same --run-id threaded through inventory and
    // select-tracks lands here, so inventory.toon ↔ plan.toon ↔ scoreboard.toon share one runId.
    const runId = argRunId(argv) ?? `agg-${out.target.split(/[\\/]/).pop() ?? "run"}`;
    const inputs = [opt.passA, opt.passB, opt.passC, opt.plan, opt.evidence].filter((x) => Boolean(x));
    const stamped = { provenance: makeProvenance("aggregate", runId, inputs, undefined, readToolVersion()), ...out };
    process.stdout.write(toonStringify(stamped) + "\n");
    cliOk("aggregate", `run=${runId}, tracks=${Object.keys(out.scoreboard.radarByTrack).join("+") || "—"}, wIndex=${out.scoreboard.weightedIndex ?? "—"}, M2=${out.scoreboard.m2Flag.score}`);
}
// CLI only when invoked directly; importing the module (tests) is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("aggregate", main);
