// report.ts — deterministic formatter for a single scoreboard.toon (S4 output).
// Replaces hand-written inline extraction: prints a markdown report by default,
// or the flat BoardSummary TOON with --json. No LLM judgement — pure formatting.
//
//   node scripts/report.mjs <outdir>/scoreboard.toon              # markdown to stdout
//   node scripts/report.mjs <outdir>/scoreboard.toon --json       # flat summary TOON
//   node scripts/report.mjs <outdir>/scoreboard.toon --html       # self-contained HTML report (radar SVG + tables)
//   node scripts/report.mjs <outdir>/scoreboard.toon --scorecard  # portable scores-only TOON (no paths/evidence)
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { summarizeBoard, summarizeScorecard, renderMarkdown } from "./report-util.mjs";
import { renderHtml } from "./report-html.mjs";
import { cliOk, runCli } from "./cli.mjs";
import { toonParse, toonStringify } from "./serde.mjs";
export function main(argv = process.argv.slice(2)) {
    const { values, positionals } = parseArgs({
        args: argv,
        options: { json: { type: "boolean" }, html: { type: "boolean" }, scorecard: { type: "boolean" } },
        allowPositionals: true,
    });
    const src = positionals[0];
    if (!src) {
        process.stderr.write("usage: report.mjs <scoreboard.toon> [--json|--html|--scorecard]\n");
        process.exit(2);
    }
    const board = toonParse(readFileSync(src, "utf8"));
    // --html is the final deliverable: a stand-alone document the orchestrator hands to the user.
    // stdout is the HTML (redirect to a .html file); stderr keeps the OK/ERR convention.
    if (values.html) {
        process.stdout.write(renderHtml(board));
        cliOk("report", `HTML for ${board.target}`);
    }
    else if (values.scorecard) {
        // Portable, environment-free scores: declaredType + creation date + the numbers, with every
        // path / evidence / run-correlation field projected out — safe to publish or archive.
        process.stdout.write(toonStringify(summarizeScorecard(board)) + "\n");
        cliOk("report", `scorecard toon (no paths/evidence)`);
    }
    else {
        const summary = summarizeBoard(board);
        process.stdout.write((values.json ? toonStringify(summary) : renderMarkdown(summary)) + "\n");
        cliOk("report", `${values.json ? "summary toon" : "markdown"} for ${summary.target}`);
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("report", main);
