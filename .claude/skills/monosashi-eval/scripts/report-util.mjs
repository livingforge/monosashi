const TRACK_ORDER = ["M", "G", "A", "S", "H", "K"];
export function orderedTrackKeys(keys) {
    return [...keys].sort((a, b) => {
        const ia = TRACK_ORDER.indexOf(a), ib = TRACK_ORDER.indexOf(b);
        if (ia === -1 && ib === -1)
            return a.localeCompare(b);
        if (ia === -1)
            return 1;
        if (ib === -1)
            return -1;
        return ia - ib;
    });
}
export function summarizeBoard(board) {
    const sb = board.scoreboard;
    const merged = Array.isArray(board.mergedScores) ? board.mergedScores : [];
    const tracks = {};
    const trackN = {};
    for (const t of orderedTrackKeys(Object.keys(sb.radarByTrack))) {
        tracks[t] = sb.radarByTrack[t].mean;
        trackN[t] = sb.radarByTrack[t].n;
    }
    const domains = {};
    for (const [d, v] of Object.entries(sb.radarByDomain))
        domains[d] = v.mean;
    const needsHumanReview = (board.needsHumanReview ?? []).map((x) => ({
        criterion: x.criterion,
        range: typeof x.diff === "number" ? x.diff : undefined,
    }));
    // dedupe by criterion (merged scores are 1-per-criterion, but be defensive)
    const seen = new Set();
    const criteria = {};
    const lowConfidence = [];
    for (const m of merged) {
        if (seen.has(m.criterion))
            continue;
        seen.add(m.criterion);
        criteria[m.criterion] = m.score;
        if (m.confidence === "low")
            lowConfidence.push(m.criterion);
    }
    const m2 = sb.m2Flag;
    return {
        target: board.target,
        declaredType: board.declaredType,
        weighting: sb.weighting,
        weightedIndex: sb.weightedIndex,
        overallMean: sb.overallMean,
        naCount: sb.naCount,
        tracks,
        trackN,
        domains,
        m2: {
            divergent: Boolean(m2.divergent),
            severity: m2.severity ?? (m2.note ? "not derived" : "ok"),
            score: m2.score,
            rationale: m2.rationale ?? m2.note ?? "",
        },
        reconciliation: board.reconciliation,
        confidence: sb.confidence,
        needsHumanReview,
        lowConfidence,
        criteria,
        runId: board.provenance?.runId,
        producedAt: board.provenance?.producedAt,
        toolVersion: board.provenance?.toolVersion,
        audit: board.audit,
    };
}
/** Project a full scoreboard to the portable {@link Scorecard} — drops `target`, the run
 *  correlation header, the audit trail, and every evidence citation; keeps only the numbers,
 *  the declared type, and the creation date. Reuses {@link summarizeBoard} so the score values
 *  are identical to the markdown/HTML reports — this is a strict field projection, not a re-derive. */
export function summarizeScorecard(board) {
    const s = summarizeBoard(board);
    return {
        declaredType: s.declaredType,
        producedAt: s.producedAt,
        toolVersion: s.toolVersion,
        weighting: s.weighting,
        scores: {
            overallMean: s.overallMean,
            weightedIndex: s.weightedIndex,
            naCount: s.naCount,
            tracks: s.tracks,
            domains: s.domains,
            m2: { divergent: s.m2.divergent, severity: s.m2.severity, score: s.m2.score },
            criteria: s.criteria,
        },
    };
}
const fmt = (x) => x === null || x === undefined ? "—" : x === "N/A" ? "N/A" : String(Math.round(x * 100) / 100);
/** Human-readable markdown report for a single artifact. Leads with the radar (never a
 *  single number alone) and surfaces the M2 flag independently (§ reporting rules). */
export function renderMarkdown(s) {
    const L = [];
    L.push(`# Monosashi report — ${s.target}`);
    L.push("");
    L.push(`- declared type: **${s.declaredType ?? "—"}**`);
    L.push(`- weighting: **${s.weighting}**`);
    if (s.runId)
        L.push(`- run id: \`${s.runId}\`${s.producedAt ? ` (${s.producedAt})` : ""}${s.toolVersion ? `, toolchain v${s.toolVersion}` : ""} — correlates inventory.toon / plan.toon / scoreboard.toon of this run`);
    L.push("");
    L.push(`## Radar — track means (primary signal, not a single number)`);
    L.push("");
    L.push(`| Track | Mean | n |`);
    L.push(`|---|---|---|`);
    for (const [t, m] of Object.entries(s.tracks))
        L.push(`| ${t} | ${fmt(m)} | ${s.trackN[t]} |`);
    L.push("");
    L.push(`Domains: ` + Object.entries(s.domains).map(([d, m]) => `${d}=${fmt(m)}`).join("  "));
    L.push("");
    const m2 = s.m2;
    L.push(`## M2 — declaration↔reality divergence (mechanical, independent flag)`);
    L.push("");
    L.push(`- divergent: **${m2.divergent}**${m2.score !== undefined ? ` (score ${m2.score})` : ""}`);
    L.push(`- severity: **${m2.severity}**`);
    if (m2.rationale)
        L.push(`- ${m2.rationale}`);
    L.push("");
    L.push(`## Weighted index (secondary) — ${fmt(s.weightedIndex)}  (overallMean ${fmt(s.overallMean)})`);
    L.push("");
    const r = s.reconciliation;
    L.push(`## Reconciliation & confidence`);
    L.push("");
    if (r) {
        L.push(`- compared=${r.comparedNumeric} exactAgreement=${fmt(r.exactAgreement)} ` +
            `tieBroken=${r.tieBroken ?? 0} singlePass=${r.singlePass ?? 0}`);
    }
    else {
        L.push(`- single pass (no second opinion run)`);
    }
    L.push(`- confidence high/medium/low = ${s.confidence.high}/${s.confidence.medium}/${s.confidence.low}  naCount=${s.naCount}`);
    L.push(`- needsHumanReview: ` +
        (s.needsHumanReview.length
            ? s.needsHumanReview.map((x) => `${x.criterion}${x.range !== undefined ? `(range ${x.range})` : ""}`).join(", ")
            : "none"));
    L.push(`- low-confidence scores: ` + (s.lowConfidence.length ? s.lowConfidence.join(", ") : "none"));
    L.push("");
    L.push(`## Per-criterion scores`);
    L.push("");
    L.push(Object.entries(s.criteria).map(([c, v]) => `${c}=${fmt(v)}`).join("  "));
    L.push("");
    // Audit trail (A5/H3): which passes judged each criterion, by what method, on what evidence —
    // a traceable judgement-provenance log, correlated to the run by the runId above.
    if (s.audit && s.audit.trail.length) {
        const p = s.audit.passes;
        L.push(`## Audit trail (passes A${p.B ? "+B" : ""}${p.C ? "+C" : ""})`);
        L.push("");
        L.push(`| Criterion | Score | Method | Passes | Evidence | Review |`);
        L.push(`|---|---|---|---|---|---|`);
        for (const e of s.audit.trail) {
            const passes = e.judgements.map((j) => `${j.pass}=${fmt(j.score)}/${j.confidence}`).join(" ");
            const ev = e.evidence.length
                ? e.evidence.map((x) => `${x.path}${x.lines ? `:${x.lines}` : ""}`).slice(0, 2).join(", ")
                : "—";
            L.push(`| ${e.criterion} | ${fmt(e.finalScore)} (${e.confidence}) | ${e.method} | ${passes} | ${ev} | ${e.needsHumanReview ? "⚠" : ""} |`);
        }
        L.push("");
    }
    return L.join("\n");
}
