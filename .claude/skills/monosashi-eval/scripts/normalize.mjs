// normalize.ts — absorb LLM output variance ("揺れ") before the deterministic tools consume
// the LLM-produced artifacts (capability profile, evidence pack, score passes).
//
// The judge agents emit JSON, but an LLM's surface form for the *same logical value* drifts
// run to run: "Present" vs "present", "n/a"/"NA"/"N/A.", the number 3 vs the string "3",
// "High" confidence, "k1" instead of "K1", a line range written "L42" or "120–145" (en-dash).
// Left raw, that drift silently skews the result — a string "3" is dropped from the radar
// (aggregate keeps only `typeof === "number"`), a stray "High" forces a needless second pass,
// a lower-cased id never matches the plan and reads as a *missing* criterion.
//
// This module canonicalises each field to the schema's legal form and RECORDS every change as
// an auditable `Coercion` — nothing is altered silently, because this is an evaluation tool and
// the operator must be able to see what the LLM actually wrote. Every canonicaliser returns
// `undefined` for input it cannot interpret (e.g. score "five"); the caller then KEEPS the raw
// value so the downstream validator still flags it as a hard error rather than hiding it.
//
// Pure, deterministic, no IO. Shared by validate-profile/pass/evidence, aggregate, select-tracks,
// second-opinion and contested so the whole pipeline tolerates the same surface drift.
/** Lower-case + trim a value to a lookup key; non-strings become "". */
function key(raw) {
    return typeof raw === "string" ? raw.trim().toLowerCase() : typeof raw === "number" ? String(raw) : "";
}
// ── Enum canonicalisers (case / whitespace / common synonyms) ──────────────────────────────
const PRESENCE_SYNONYMS = {
    present: "present", partial: "partial", absent: "absent",
    // synonyms the judge sometimes reaches for
    yes: "present", y: "present", true: "present", full: "present", complete: "present", strong: "present",
    no: "absent", none: "absent", missing: "absent", false: "absent", n: "absent", nil: "absent",
    some: "partial", partially: "partial", weak: "partial", limited: "partial", minimal: "partial",
};
/** Canonicalise a structural-axis presence, or undefined if uninterpretable. */
export function canonPresence(raw) {
    return PRESENCE_SYNONYMS[key(raw)];
}
const KNOWLEDGE_SYNONYMS = {
    primary: "primary", substantial: "substantial", minor: "minor", absent: "absent",
    none: "absent", missing: "absent", no: "absent", nil: "absent",
    main: "primary", dominant: "primary", core: "primary",
    substantive: "substantial", significant: "substantial", major: "substantial", large: "substantial",
    small: "minor", light: "minor", slight: "minor", some: "minor", little: "minor",
    minimal: "minor", trivial: "minor", tiny: "minor", // "minimal" is a *presence* synonym (→partial); on the knowledge ladder it is the lowest non-absent grade
};
/** Canonicalise a knowledge-presence grade, or undefined if uninterpretable. */
export function canonKnowledge(raw) {
    return KNOWLEDGE_SYNONYMS[key(raw)];
}
const CONFIDENCE_SYNONYMS = {
    high: "high", medium: "medium", low: "low",
    hi: "high", h: "high", strong: "high", certain: "high", confident: "high", sure: "high",
    med: "medium", mid: "medium", moderate: "medium", m: "medium",
    lo: "low", l: "low", weak: "low", uncertain: "low", unsure: "low", tentative: "low",
    // intensifier phrases the judge reaches for. A "*-high" boundary maps to medium (don't inflate);
    // a "*-low" boundary to low. Both space- and hyphen-joined forms, since `key()` keeps separators.
    "very high": "high", "veryhigh": "high", "fairly high": "high", "quite high": "high", "highly confident": "high",
    "very low": "low", "verylow": "low", "fairly low": "low", "quite low": "low",
    "medium high": "medium", "medium-high": "medium", "mediumhigh": "medium",
    "medium low": "medium", "medium-low": "medium", "mediumlow": "medium",
    // Japanese labels (the judge runs bilingually).
    "高": "high", "高い": "high", "中": "medium", "中程度": "medium", "低": "low", "低い": "low",
};
/** Canonicalise a confidence label, or undefined if uninterpretable. */
export function canonConfidence(raw) {
    return CONFIDENCE_SYNONYMS[key(raw)];
}
// ── Score (0..4 | "N/A") ───────────────────────────────────────────────────────────────────
// "N/A" written any number of ways. Compared after stripping every non-alphanumeric char, so
// "n/a", "N/A.", "n.a.", "not applicable" and "naa" all collapse to one of these keys.
const NA_KEYS = new Set(["na", "notapplicable", "nan", "none", "該当なし", "非該当", "対象外"]);
function naKey(raw) {
    // Strip whitespace/punctuation but keep CJK so "該当なし" survives.
    return raw.trim().toLowerCase().replace(/[\s./\\_-]+/g, "");
}
/**
 * Canonicalise a criterion score to an integer 0..4 or the literal "N/A".
 * Accepts numeric strings ("3", " 4 "), integer-valued or near-integer floats ("3.0", 3.4 → 3),
 * and the many "N/A" spellings. Returns undefined for anything else (e.g. "five", 7, -1) so the
 * validator still rejects it — out-of-range and nonsense are NOT silently clamped away.
 */
export function canonScore(raw) {
    if (typeof raw === "number")
        return finiteToScore(raw);
    if (typeof raw === "string") {
        const t = raw.trim();
        if (t === "")
            return undefined;
        if (NA_KEYS.has(naKey(t)))
            return "N/A";
        const n = Number(t);
        if (Number.isFinite(n))
            return finiteToScore(n);
        return undefined;
    }
    return undefined;
}
function finiteToScore(n) {
    if (!Number.isFinite(n))
        return undefined;
    const r = Math.round(n);
    return r >= 0 && r <= 4 ? r : undefined;
}
// ── Booleans (hasCodePath) ──────────────────────────────────────────────────────────────────
const TRUE_KEYS = new Set(["true", "yes", "y", "1", "t", "present"]);
const FALSE_KEYS = new Set(["false", "no", "n", "0", "f", "absent"]);
/** Canonicalise a boolean-ish value, or undefined if uninterpretable. */
export function canonBool(raw) {
    if (typeof raw === "boolean")
        return raw;
    if (typeof raw === "number")
        return raw === 1 ? true : raw === 0 ? false : undefined;
    if (typeof raw === "string") {
        const k = raw.trim().toLowerCase();
        if (TRUE_KEYS.has(k))
            return true;
        if (FALSE_KEYS.has(k))
            return false;
    }
    return undefined;
}
// ── Criterion ids ("k1 " / "M 2" → "K1" / "M2") ─────────────────────────────────────────────
/** Canonicalise a criterion id: trim, upper-case, drop a leading "Criterion"/"基準" label, and
 *  strip the separators an LLM sprinkles in ("K-1", "K.1", "M2.", "k_1", "G/1"). Every real
 *  rubric id is `[A-Z]\d` (no punctuation), so collapsing these chars cannot merge two ids. */
export function canonCriterionId(raw) {
    if (typeof raw !== "string")
        return String(raw ?? "");
    return raw
        .trim()
        .toUpperCase()
        .replace(/^(?:CRITERION|CRITERIA|基準)\s*[:#]?\s*/, "")
        .replace(/[\s.\-_/:#]+/g, "");
}
// ── Line ranges ("L42", "120 – 145", "lines 9") → "42" / "120-145" / "9" ───────────────────
/** Canonicalise a line-range citation to the bare "N" / "N-M" form parseLineRange expects, or
 *  undefined if it cannot be coerced (the caller keeps the raw value for the validator to flag). */
export function canonLines(raw) {
    if (typeof raw === "number")
        return Number.isInteger(raw) && raw >= 1 ? String(raw) : undefined;
    if (typeof raw !== "string")
        return undefined;
    const cleaned = raw
        .trim()
        .replace(/[‒-―−]/g, "-") // figure/en/em dash + minus → hyphen
        .replace(/lines?/gi, "")
        .replace(/[Ll](?=\d)/g, "") // a leading "L" before a digit ("L42")
        .replace(/\s+/g, "");
    const m = cleaned.match(/^(\d+)(?:-(\d+))?$/);
    return m ? cleaned : undefined;
}
// ── Evidence paths ("src\\foo.ts" / "./src/foo.ts" / "/src/foo.ts" → "src/foo.ts") ──────────
/** Canonicalise an evidence file path's *surface* form (pure string — NOT filesystem-grounded):
 *  back-slashes → "/", collapse duplicate slashes, strip a leading "./" or "/", and resolve any
 *  "."/".." segments — so the same file cited "src\\foo.ts", "./src/foo.ts" and "/src/foo.ts"
 *  collapses to one string and stops reading as three different files in coverage / dedup / the
 *  A∩B citation overlap. Case is preserved (display); a trailing ":line" suffix is left intact
 *  (it is stripped only at resolve time by evidence-util). Filesystem-grounded snapping of a
 *  drifted or partial path to a real on-disk file is a separate step (validate-evidence --target,
 *  evidence-util.snapPath). Returns undefined for a non-string / empty path so the caller keeps
 *  the raw value and the validator still flags it. */
export function canonPath(raw) {
    if (typeof raw !== "string")
        return undefined;
    const trimmed = raw.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
    if (trimmed === "")
        return undefined;
    const out = [];
    for (const seg of trimmed.split("/")) {
        if (seg === "" || seg === ".")
            continue;
        if (seg === ".." && out.length && out[out.length - 1] !== "..")
            out.pop();
        else
            out.push(seg);
    }
    const joined = out.join("/");
    return joined === "" ? undefined : joined;
}
// ── evidenceRefs ([ "0", 1.0 ] → [0, 1]) ───────────────────────────────────────────────────
/** Canonicalise an evidenceRefs array to non-negative integers, or undefined if not an array. */
export function canonRefs(raw) {
    if (!Array.isArray(raw))
        return undefined;
    const out = [];
    for (const v of raw) {
        const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
        if (Number.isFinite(n) && Number.isInteger(n) && n >= 0)
            out.push(n);
    }
    return out;
}
// ── Composite normalisers ──────────────────────────────────────────────────────────────────
// Each deep-clones its input, applies the canonicalisers, and returns the normalised object plus
// the list of coercions actually performed. A canonicaliser returning undefined leaves the raw
// value in place (so the downstream validator still rejects genuinely-malformed input).
function clone(v) {
    return JSON.parse(JSON.stringify(v));
}
/** Record a coercion when canon !== raw (both compared as JSON to ignore numeric/string form). */
function note(coercions, path, from, to) {
    if (to !== undefined && JSON.stringify(from) !== JSON.stringify(to))
        coercions.push({ path, from, to });
}
/** Normalise a capability profile (axes presence/knowledge, hasCodePath, trims). */
export function normalizeProfile(raw) {
    const coercions = [];
    const p = (raw && typeof raw === "object" ? clone(raw) : {});
    if (typeof p.target === "string")
        p.target = p.target.trim();
    if (typeof p.declaredType === "string")
        p.declaredType = p.declaredType.trim();
    if (p.axes && typeof p.axes === "object") {
        for (const k of ["orchestration", "encapsulation", "harness"]) {
            const c = canonPresence(p.axes[k]);
            note(coercions, `axes.${k}`, p.axes[k], c);
            if (c !== undefined)
                p.axes[k] = c;
        }
        const kn = canonKnowledge(p.axes.knowledge);
        note(coercions, "axes.knowledge", p.axes.knowledge, kn);
        if (kn !== undefined)
            p.axes.knowledge = kn;
    }
    const b = canonBool(p.hasCodePath);
    note(coercions, "hasCodePath", p.hasCodePath, b);
    if (b !== undefined)
        p.hasCodePath = b;
    // riskSurface (drives A4 N/A): absorb LLM surface drift — `class` casing ("High"→"high") and a
    // string/loose `external` ("yes"→true) — so a stray surface form never flips the A4 N/A decision.
    if (Array.isArray(p.riskSurface)) {
        p.riskSurface.forEach((o, i) => {
            if (!o || typeof o !== "object")
                return;
            if (typeof o.class === "string") {
                const c = o.class.trim().toLowerCase();
                note(coercions, `riskSurface[${i}].class`, o.class, c);
                o.class = c;
            }
            const ext = canonBool(o.external);
            note(coercions, `riskSurface[${i}].external`, o.external, ext);
            if (ext !== undefined)
                o.external = ext;
        });
    }
    return { profile: p, coercions };
}
/** Normalise a judge pass (criterion ids, scores, confidence, evidenceRefs). */
export function normalizePass(raw) {
    const coercions = [];
    const p = (raw && typeof raw === "object" ? clone(raw) : {});
    if (typeof p.declaredType === "string")
        p.declaredType = p.declaredType.trim();
    if (Array.isArray(p.scores)) {
        p.scores.forEach((s, i) => {
            if (!s || typeof s !== "object")
                return;
            const id = canonCriterionId(s.criterion);
            note(coercions, `scores[${i}].criterion`, s.criterion, id);
            if (id)
                s.criterion = id;
            const sc = canonScore(s.score);
            note(coercions, `scores[${i}].score`, s.score, sc);
            if (sc !== undefined)
                s.score = sc;
            const conf = canonConfidence(s.confidence);
            note(coercions, `scores[${i}].confidence`, s.confidence, conf);
            if (conf !== undefined)
                s.confidence = conf;
            if (s.evidenceRefs !== undefined) {
                const refs = canonRefs(s.evidenceRefs);
                note(coercions, `scores[${i}].evidenceRefs`, s.evidenceRefs, refs);
                if (refs !== undefined)
                    s.evidenceRefs = refs;
            }
            // Canonicalise inline-citation paths the same way pack-candidate paths are canonicalised
            // (normalizePack), so the same file cited "src\\foo.ts" / "./src/foo.ts" / "/src/foo.ts"
            // resolves to one string in the verbatim check and the A∩B citation overlap.
            if (Array.isArray(s.evidence)) {
                s.evidence.forEach((e, k) => {
                    if (e && typeof e.path === "string") {
                        const cp = canonPath(e.path);
                        note(coercions, `scores[${i}].evidence[${k}].path`, e.path, cp);
                        if (cp !== undefined)
                            e.path = cp;
                    }
                });
            }
        });
    }
    return { pass: p, coercions };
}
/** Normalise an evidence pack (criterion ids, candidate paths, line ranges). */
export function normalizePack(raw) {
    const coercions = [];
    const p = (raw && typeof raw === "object" ? clone(raw) : {});
    if (Array.isArray(p.items)) {
        p.items.forEach((it, i) => {
            if (!it || typeof it !== "object")
                return;
            const id = canonCriterionId(it.criterion);
            note(coercions, `items[${i}].criterion`, it.criterion, id);
            if (id)
                it.criterion = id;
            if (Array.isArray(it.candidates)) {
                it.candidates.forEach((c, j) => {
                    if (!c || typeof c !== "object")
                        return;
                    if (typeof c.path === "string") {
                        const cp = canonPath(c.path);
                        note(coercions, `items[${i}].candidates[${j}].path`, c.path, cp);
                        if (cp !== undefined)
                            c.path = cp;
                    }
                    if (c.lines !== undefined) {
                        const ln = canonLines(c.lines);
                        note(coercions, `items[${i}].candidates[${j}].lines`, c.lines, ln);
                        if (ln !== undefined)
                            c.lines = ln;
                    }
                });
            }
        });
    }
    return { pack: p, coercions };
}
/** Format coercions as human-readable warning lines for a validator report. */
export function coercionWarnings(coercions) {
    return coercions.map((c) => `normalised ${c.path}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)} (LLM 出力ゆれを吸収)`);
}
