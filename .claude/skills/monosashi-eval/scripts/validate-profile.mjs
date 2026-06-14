// Stage 1.5 (gate after S1, before S2): validate a capability profile produced by the
// profiler against the CapabilityProfile schema BEFORE select-tracks consumes it, so a
// malformed profile fails loudly instead of silently producing a wrong track plan / wrong
// mechanical M2. Deterministic, static — never executes the target.
//
// Checks (hard errors -> exit 1):
//   - top-level object with a non-empty string `target`
//   - `axes` present with orchestration/encapsulation/harness ∈ {present,partial,absent}
//     and knowledge ∈ {primary,substantial,minor,absent}
//   - `hasCodePath` is a boolean
//   - `declaredType` (if present) is a string or null
//   - `riskSurface` (if present) is an array of {op, evidence:{path,lines}, class, external}
// Warnings (exit 0, reported):
//   - `declaredType` missing/null (M2 will be Lv1 "ambiguous")
//   - `note` missing (no human-readable axis rationale)
//   - `riskSurface` missing (A4 cannot be N/A-by-rule; it will be scored — the safe default)
//
// Usage:
//   node validate-profile.mjs <profile.toon>
import { pathToFileURL } from "node:url";
import { normalizeProfile, coercionWarnings } from "./normalize.mjs";
import { cliDone, runCli } from "./cli.mjs";
import { readToonFile, toonStringify } from "./serde.mjs";
const PRESENCE = new Set(["present", "partial", "absent"]);
const KNOWLEDGE = new Set(["primary", "substantial", "minor", "absent"]);
const RISK_CLASS = new Set(["none", "low", "high"]);
/** Validate a capability profile (after absorbing LLM surface drift). Pure — no IO. Returns the
 *  error/warning lists; coercions performed during normalisation are surfaced as warnings so the
 *  operator can see what the LLM actually wrote. Exported so the CLI and tests share one path. */
export function validateProfile(raw) {
    if (typeof raw !== "object" || raw === null) {
        return { ok: false, errors: ["profile is not an object"], warnings: [] };
    }
    const { profile: prof, coercions } = normalizeProfile(raw);
    const errors = [];
    const warnings = coercionWarnings(coercions);
    if (typeof prof.target !== "string" || prof.target.trim() === "")
        errors.push(`target must be a non-empty string (got ${JSON.stringify(prof.target)})`);
    const a = prof.axes;
    if (typeof a !== "object" || a === null) {
        errors.push("axes is missing or not an object");
    }
    else {
        for (const k of ["orchestration", "encapsulation", "harness"]) {
            if (!PRESENCE.has(a[k]))
                errors.push(`axes.${k} must be present|partial|absent (got ${JSON.stringify(a[k])})`);
        }
        if (!KNOWLEDGE.has(a.knowledge))
            errors.push(`axes.knowledge must be primary|substantial|minor|absent (got ${JSON.stringify(a.knowledge)})`);
    }
    if (typeof prof.hasCodePath !== "boolean")
        errors.push(`hasCodePath must be a boolean (got ${JSON.stringify(prof.hasCodePath)})`);
    if (prof.declaredType !== undefined && prof.declaredType !== null && typeof prof.declaredType !== "string")
        errors.push(`declaredType must be a string or null (got ${JSON.stringify(prof.declaredType)})`);
    if (prof.declaredType === undefined || prof.declaredType === null)
        warnings.push("declaredType missing/null — mechanical M2 will be Lv1 (種別が判別困難)");
    if (prof.note !== undefined && typeof prof.note !== "string")
        errors.push("note must be a string when present");
    else if (prof.note === undefined)
        warnings.push("note missing — no human-readable axis rationale for the report");
    // riskSurface (drives A4 N/A-by-rule). Optional, but when present must be a well-formed array
    // of {op, evidence:{path,lines}, class∈{none,low,high}, external:boolean}. A malformed entry
    // would silently skew the A4 N/A decision, so it is a hard error.
    if (prof.riskSurface !== undefined) {
        if (!Array.isArray(prof.riskSurface)) {
            errors.push(`riskSurface must be an array when present (got ${JSON.stringify(prof.riskSurface)})`);
        }
        else {
            prof.riskSurface.forEach((o, i) => {
                const at = `riskSurface[${i}]`;
                if (typeof o !== "object" || o === null)
                    return void errors.push(`${at} must be an object`);
                if (typeof o.op !== "string" || o.op.trim() === "")
                    errors.push(`${at}.op must be a non-empty string`);
                if (!RISK_CLASS.has(o.class))
                    errors.push(`${at}.class must be none|low|high (got ${JSON.stringify(o.class)})`);
                if (typeof o.external !== "boolean")
                    errors.push(`${at}.external must be a boolean (got ${JSON.stringify(o.external)})`);
                const ev = o.evidence;
                if (typeof ev !== "object" || ev === null || typeof ev.path !== "string" || typeof ev.lines !== "string")
                    errors.push(`${at}.evidence must be {path:string, lines:string}`);
            });
        }
    }
    else {
        warnings.push("riskSurface missing — A4 cannot be N/A-by-rule and will be scored (safe default)");
    }
    return { ok: errors.length === 0, errors, warnings };
}
export function main(argv = process.argv.slice(2)) {
    const file = argv[0];
    if (!file) {
        console.error("Usage: validate-profile <profile.toon>");
        process.exit(2);
    }
    const { ok, errors, warnings } = validateProfile(readToonFile(file));
    const report = {
        profile: file,
        ok,
        counts: { errors: errors.length, warnings: warnings.length },
        errors,
        warnings,
    };
    process.stderr.write(toonStringify(report) + "\n");
    cliDone("validate-profile", ok, ok ? `valid (${warnings.length} warning(s))` : `${errors.length} error(s)`);
    process.exit(ok ? 0 : 1);
}
// CLI only when invoked directly; importing the module (tests) is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("validate-profile", main);
