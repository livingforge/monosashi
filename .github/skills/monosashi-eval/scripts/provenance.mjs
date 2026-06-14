// provenance.ts — correlation ID + run lineage for the eval pipeline (A5 観測性 / H3 監査基盤).
//
// One evaluation run is one `runId`. Every *deterministic* tool stamps a `Provenance` envelope
// onto its stage artifact (inventory.toon → plan.toon → scoreboard.toon), so the artifacts of a
// single run are correlatable by `runId` and the audit trail (which pass judged which criterion,
// when, on what evidence — built in aggregate) is traceable end to end. This is the difference
// between Lv2 "structured logs" and Lv3 "相関ID/監査ログ/トレースが設計され追跡可能" (A5/H3).
//
// The wall clock lives ONLY here and is called ONLY from each tool's `main()`. The pure scoring
// functions (buildPlan / aggregate / buildAudit) never touch it, so they stay clock-free and
// deterministic for the unit tests — provenance is metadata, never an input to any score.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
let cachedVersion;
/** Best-effort read of the toolchain semver from the sibling package.json (scripts/../package.json
 *  in the shipped skill, dist/../package.json in dev). Cached; returns undefined if unreadable, so
 *  stamping a version never breaks a run. This is what makes every stage artifact self-describe
 *  which toolchain version produced it (K4 版↔API correspondence; see package-meta/monosashi/CHANGELOG.md). */
export function readToolVersion() {
    if (cachedVersion !== undefined)
        return cachedVersion ?? undefined;
    try {
        const dir = dirname(fileURLToPath(import.meta.url));
        const pkg = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf8"));
        cachedVersion = typeof pkg.version === "string" ? pkg.version : null;
    }
    catch {
        cachedVersion = null;
    }
    return cachedVersion ?? undefined;
}
/** Parse `--run-id <id>` from argv; null when absent (the S0 tool then mints one). */
export function argRunId(argv) {
    const i = argv.indexOf("--run-id");
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
/** Mint a correlation ID from the target basename + a compact UTC timestamp. The timestamp keeps
 *  distinct runs of the same target from colliding; sanitised to the `eval-out/<name>` charset. */
export function mintRunId(target, now = new Date()) {
    const base = (target.split(/[\\/]/).pop() || "run").replace(/[^A-Za-z0-9._-]/g, "-") || "run";
    const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    return `${base}-${ts}`;
}
/** Build a provenance envelope. Clock defaults to now() but is injectable for tests; the
 *  toolchain version is optional (resolved via readToolVersion() at each tool's main()). */
export function makeProvenance(producedBy, runId, inputs = [], now = new Date(), toolVersion) {
    return {
        runId,
        producedBy,
        ...(toolVersion ? { toolVersion } : {}),
        producedAt: now.toISOString(),
        ...(inputs.length ? { inputs } : {}),
    };
}
