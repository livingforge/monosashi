// Stage 2 (§5): mechanically derive applicable tracks + per-criterion N/A from a
// capability profile. Deterministic — no LLM judgement here. Per the task, ALL
// matching tracks are applied (no single "primary type"); M2 stays an independent flag.
//
// Usage:
//   node select-tracks.mjs <profile.toon>          # file
//   cat profile.toon | node select-tracks.mjs -    # stdin
// Output: TOON track-application plan on stdout.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RUBRIC } from "./rubric.mjs";
import { normalizeProfile } from "./normalize.mjs";
import { cliOk, runCli } from "./cli.mjs";
import { toonParse, toonStringify } from "./serde.mjs";
import { argRunId, makeProvenance, readToolVersion } from "./provenance.mjs";
function readInput(arg) {
    if (!arg || arg === "-")
        return readFileSync(0, "utf8");
    return readFileSync(arg, "utf8");
}
function isOn(p) {
    return p === "present" || p === "partial";
}
/** Stage-2 applicability table (§5). */
export function trackApplies(id, prof) {
    const a = prof.axes;
    switch (id) {
        case "M":
            return true; // 常に適用
        case "G":
            return true; // 常に適用
        case "A":
            return isOn(a.orchestration);
        case "S":
            return isOn(a.encapsulation);
        case "H":
            return isOn(a.harness);
        case "K":
            return a.knowledge === "primary" || a.knowledge === "substantial";
    }
}
export function declaredAxisOf(declaredType) {
    if (!declaredType)
        return null;
    const t = declaredType.toLowerCase();
    if (t.includes("agent"))
        return "orchestration";
    if (t.includes("skill"))
        return "encapsulation";
    if (t.includes("harness"))
        return "harness";
    if (t.includes("knowledge") || t.includes("doc") || t.includes("guide") || t.includes("reference") || t.includes("instruction"))
        return "knowledge";
    return null;
}
/** Mechanical M2 (declaration↔reality), derived from the capability profile alone — no
 *  LLM judgement (§6). Conservative: 0 when the declared capability axis is absent, 1 when
 *  the declared type is unrecognisable, 2 when a structural sub-component (agent/skill/
 *  harness) is present but undeclared, else 3. Capped at 3 (4 needs documented-composition
 *  evidence). Knowledge presence is NOT treated as an undeclared sub-component — almost
 *  every artifact carries prose, so it would over-flag. */
export function computeM2(prof) {
    const axes = prof.axes;
    const declaredType = prof.declaredType ?? null;
    const decAxis = declaredAxisOf(declaredType);
    const structural = [
        { type: "orchestration(agent)", axis: "orchestration" },
        { type: "encapsulation(skill)", axis: "encapsulation" },
        { type: "harness", axis: "harness" },
    ];
    const onStructural = structural.filter((s) => isOn(axes[s.axis])).map((s) => s.type);
    const base = {
        criterion: "M2",
        mechanical: true,
        basis: { declaredType, onStructuralAxes: onStructural, declaredAxis: decAxis },
    };
    // (a0) declared "composite": the bundle claims to be more than one structural thing
    // (agent/skill/harness — e.g. Monosashi). It maps to no single axis, so it bypasses the
    // single-axis logic below. Faithful (Lv3) when ≥2 structural axes are actually on; an
    // over-claim (Lv0) when reality is single/none — the same conservative direction as (b).
    if (declaredType === "composite") {
        if (onStructural.length >= 2) {
            return {
                ...base,
                score: 3,
                divergent: false,
                severity: "ok",
                rationale: `宣言 'composite' と実体が一致 — 構造的能力軸 [${onStructural.join(", ")}] を複数内包 (Lv3)`,
            };
        }
        return {
            ...base,
            score: 0,
            divergent: true,
            severity: "HIGH — 宣言乖離が大きい",
            rationale: `宣言 'composite' だが構造的能力軸が ${onStructural.length} 個のみ [${onStructural.join(", ") || "なし"}] — 実体は複合的でない (Lv0)`,
        };
    }
    // (a) declared type unrecognisable → Lv1 (種別が曖昧で判別困難).
    if (!decAxis) {
        return {
            ...base,
            score: 1,
            divergent: true,
            severity: "MEDIUM — 種別が判別困難",
            rationale: `declaredType=${JSON.stringify(declaredType)} は種別を一意に判定できない (Lv1: 種別が曖昧)`,
        };
    }
    // Is the declared capability actually present (present|partial, or knowledge primary|substantial)?
    const declaredOn = decAxis === "knowledge" ? axes.knowledge === "primary" || axes.knowledge === "substantial" : isOn(axes[decAxis]);
    // (b) declared capability absent →実体が別物, Lv0 (the critical independent flag).
    if (!declaredOn) {
        return {
            ...base,
            score: 0,
            divergent: true,
            severity: "HIGH — 宣言乖離が大きい",
            rationale: `宣言 '${declaredType}' に対応する軸 ${decAxis} が absent — 実体が別物 (Lv0)`,
        };
    }
    // (c) declared capability present. Undeclared *structural* sub-components beyond the
    // declared type's own axis → Lv2; otherwise the declaration is faithful → Lv3.
    const ownAxis = decAxis === "knowledge" ? null : decAxis;
    const undeclared = structural.filter((s) => isOn(axes[s.axis]) && s.axis !== ownAxis).map((s) => s.type);
    if (undeclared.length > 0) {
        return {
            ...base,
            score: 2,
            divergent: true,
            severity: "LOW — 副成分が未宣言",
            rationale: `宣言 '${declaredType}' は一致するが、未宣言の構造的副成分 [${undeclared.join(", ")}] を内包 (Lv2)`,
        };
    }
    return {
        ...base,
        score: 3,
        divergent: false,
        severity: "ok",
        rationale: `宣言 '${declaredType}' と実体が一致し、未宣言の構造的副成分なし (Lv3; Lv4 は構成の明示的文書化が必要で機械判定の範囲外)`,
    };
}
/** True when the profiler actually emitted a risk surface (a present, array-typed field).
 *  Distinguishes "extracted, found nothing high" (→ A4 N/A) from "not extracted" (→ score A4). */
export function riskSurfaceExtracted(prof) {
    return Array.isArray(prof.riskSurface);
}
/** True when the extracted risk surface carries at least one `class:"high"` op (the only class
 *  that triggers A4). Safe on a missing/empty surface (returns false). */
export function hasHighRiskOp(prof) {
    return Array.isArray(prof.riskSurface) && prof.riskSurface.some((o) => o && o.class === "high");
}
/** Build the deterministic Stage-2 application plan from a capability profile. Pure — no IO,
 *  no LLM. Exported so the CLI `main()` and the unit tests share one code path. */
export function buildPlan(prof) {
    const appliedTracks = [];
    const naByRule = [];
    const toScore = [];
    for (const track of RUBRIC.tracks) {
        const applies = trackApplies(track.id, prof);
        if (!applies)
            continue;
        appliedTracks.push(track.id);
        for (const c of track.criteria) {
            // M2 is computed mechanically (computeM2) and surfaced as plan.m2 — the LLM passes
            // do not score it, so keep it out of criteriaToScore.
            if (c.id === "M2")
                continue;
            if (c.naRule === "no-code-path" && !prof.hasCodePath) {
                naByRule.push({ criterion: c.id, reason: "コード経路が無いため N/A (§5/§6 G2)" });
                continue;
            }
            // A4 (approval design): when the S1 risk surface was extracted AND carries no high-risk
            // (external/irreversible) op, there is nothing to gate → N/A-by-rule (excluded, not
            // penalised). An absent/undefined riskSurface is "not extracted" (cannot decide) and does
            // NOT trigger this — A4 is then scored normally. high = external/irreversible only.
            if (c.naRule === "no-high-risk-surface" && riskSurfaceExtracted(prof) && !hasHighRiskOp(prof)) {
                naByRule.push({ criterion: c.id, reason: "高リスク操作(対外・不可逆な副作用)が存在しないため N/A (§5/§6 A4; riskSurface に high なし)" });
                continue;
            }
            // Embed the verbatim rubric slice (levels/tags/anchor) so the judge scores from
            // this plan alone — it no longer needs to open the full rubric.toon (§7 verbatim
            // requirement is satisfied by carrying the exact level text here).
            toScore.push({
                criterion: c.id,
                track: track.id,
                title: c.title,
                tags: c.tags,
                levels: [...c.levels],
                ...(c.anchor ? { anchor: c.anchor } : {}),
            });
        }
    }
    const skippedTracks = RUBRIC.tracks
        .filter((t) => !appliedTracks.includes(t.id))
        .map((t) => ({ track: t.id, reason: `非該当: ${t.appliesWhen}` }));
    const plan = {
        target: prof.target,
        declaredType: prof.declaredType ?? null,
        axes: prof.axes,
        hasCodePath: prof.hasCodePath,
        // Carry the S1 risk surface through to the judge: when A4 is scored (≥1 high op), the judge
        // reads ONLY the plan, so the enumerated operation surface must travel here. null when the
        // profiler did not extract one. (When no high op exists, A4 is in naByRule, not scored.)
        riskSurface: prof.riskSurface ?? null,
        // Embedded rubric slice header: the 0–4 scale + version travel with the plan so the
        // judge reads ONLY this file (not rubric.toon / framework.md) to score (ref-token cut).
        rubricVersion: RUBRIC.version,
        scale: RUBRIC.scale,
        appliedTracks,
        skippedTracks,
        naByRule,
        // M2 is derived mechanically here (declaredType × axes), NOT scored by the passes;
        // aggregate surfaces it as an independent flag (--plan).
        m2: computeM2(prof),
        criteriaToScore: toScore,
        counts: {
            tracks: appliedTracks.length,
            criteria: toScore.length,
            naByRule: naByRule.length,
        },
        note: "M2(宣言乖離)は plan.m2 として機械算出済み — 採点者は M2 を採点しない。criteriaToScore[].levels に各レベル定義を逐語で同梱済み。",
    };
    return plan;
}
export function main(argv = process.argv.slice(2)) {
    // First positional that is not the `--run-id <id>` flag pair is the profile input (file or `-`).
    let input;
    let invPath;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--run-id") {
            i++;
            continue;
        }
        if (argv[i] === "--inventory") {
            invPath = argv[++i];
            continue;
        }
        if (!argv[i].startsWith("--") && input === undefined) {
            input = argv[i];
        }
    }
    // Absorb LLM surface drift (e.g. "Present", "yes", "none") before the deterministic table
    // and M2 derivation run on the profile — otherwise a typo'd axis would skew track selection.
    const { profile: prof } = normalizeProfile(toonParse(readInput(input)));
    if (!prof.axes) {
        console.error("Invalid capability profile: missing `axes`. See schema in types / SKILL.md.");
        process.exit(2);
    }
    // declaredType authority (§5): the profiler's free-text guess is model-unstable (agent/skill/
    // null drift on the same composite bundle). When the deterministic inventory is supplied,
    // adopt its path-derived `guessedDeclaredType` — composite-aware and reproducible — so the
    // report's declared type no longer depends on which model profiled. Fall back to the profiler's
    // value only when inventory detected no convention (guessedDeclaredType null).
    if (invPath) {
        try {
            const inv = toonParse(readInput(invPath));
            const guess = inv?.guessedDeclaredType;
            if (typeof guess === "string" && guess.length > 0)
                prof.declaredType = guess;
        }
        catch {
            /* inventory unreadable/malformed — keep the profiler's declaredType */
        }
    }
    const plan = buildPlan(prof);
    // Stamp the run correlation ID (A5/H3) so plan.toon shares one runId with inventory.toon and
    // scoreboard.toon. The orchestrator threads the same --run-id through every deterministic stage.
    const runId = argRunId(argv) ?? `plan-${prof.target.split(/[\\/]/).pop() ?? "run"}`;
    const stamped = { provenance: makeProvenance("select-tracks", runId, input ? [input] : [], undefined, readToolVersion()), ...plan };
    process.stdout.write(toonStringify(stamped) + "\n");
    cliOk("select-tracks", `run=${runId}, tracks=${plan.appliedTracks.join("+")}, ${plan.criteriaToScore.length} criteria, M2=${plan.m2.score}${plan.m2.divergent ? " (divergent)" : ""}`);
}
// Run as a CLI only when invoked directly (`node select-tracks.mjs …`); importing the module
// (e.g. from the test suite) is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("select-tracks", main);
