// cohort.ts — combine several artifacts' scoreboard.toon into one cohort summary.
// Replaces the hand-written cohort-summary assembly. Pure formatting, no LLM.
//
//   node scripts/cohort.mjs <a>/scoreboard.toon <b>/scoreboard.toon > eval-out/cohort-summary.toon
//   node scripts/cohort.mjs --dir eval-out > eval-out/cohort-summary.toon   # globs <dir>/*/scoreboard.toon
//   node scripts/cohort.mjs --dir eval-out --md                            # markdown table to stdout
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { summarizeBoard, orderedTrackKeys } from "./report-util.mjs";
import { cliOk, runCli } from "./cli.mjs";
import { toonParse, toonStringify } from "./serde.mjs";
/** The canonical (M,G,A,S,H,K) track-key order across a cohort's per-artifact summaries. */
export function cohortTrackKeys(summaries) {
    return orderedTrackKeys(Array.from(new Set(summaries.flatMap((s) => Object.keys(s.tracks)))));
}
/** The TOON-form cohort object (no IO): weighting is inherited from the first artifact. */
export function buildCohort(summaries) {
    return {
        weighting: summaries[0]?.weighting ?? "internal",
        count: summaries.length,
        trackKeys: cohortTrackKeys(summaries),
        artifacts: summaries,
    };
}
const fmtCell = (x) => x === null || x === undefined ? "—" : String(Math.round(x * 100) / 100);
/** The markdown comparison table for a cohort (no IO). One row per artifact, M2 surfaced as its
 *  severity (or "none") independently of the track radar, plus the needs-review count. */
export function renderCohortMd(summaries) {
    const trackKeys = cohortTrackKeys(summaries);
    const L = [];
    L.push(`# Cohort summary (${summaries.length} artifacts)`);
    L.push("");
    L.push(`| Artifact | type | wIndex | ` + trackKeys.join(" | ") + ` | M2 | needsReview |`);
    L.push(`|---|---|---|` + trackKeys.map(() => "---|").join("") + `---|---|`);
    for (const s of summaries) {
        const cells = trackKeys.map((t) => fmtCell(s.tracks[t]));
        L.push(`| ${s.target} | ${s.declaredType ?? "—"} | ${fmtCell(s.weightedIndex)} | ` +
            cells.join(" | ") +
            ` | ${s.m2.divergent ? s.m2.severity : "none"} | ${s.needsHumanReview.length} |`);
    }
    return L.join("\n");
}
export function main(argv = process.argv.slice(2)) {
    const { values, positionals } = parseArgs({
        args: argv,
        options: { dir: { type: "string" }, md: { type: "boolean" } },
        allowPositionals: true,
    });
    const boardPaths = [...positionals];
    if (values.dir) {
        const dir = values.dir;
        for (const name of readdirSync(dir)) {
            const sub = join(dir, name);
            try {
                if (!statSync(sub).isDirectory())
                    continue;
            }
            catch {
                continue;
            }
            const sbp = join(sub, "scoreboard.toon");
            if (existsSync(sbp))
                boardPaths.push(sbp);
        }
    }
    if (!boardPaths.length) {
        process.stderr.write("usage: cohort.mjs <scoreboard.toon...> | --dir <evalOutDir> [--md]\n");
        process.exit(2);
    }
    const summaries = boardPaths.map((p) => summarizeBoard(toonParse(readFileSync(p, "utf8"))));
    process.stdout.write((values.md ? renderCohortMd(summaries) : toonStringify(buildCohort(summaries))) + "\n");
    cliOk("cohort", `${summaries.length} artifact(s), ${values.md ? "md" : "toon"}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("cohort", main);
