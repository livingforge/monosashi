// ===== NEUTRALISED COPY — DO NOT RUN =====
// Reference-only copy of run-eval.mjs, shipped into the pack catalog so the eval harness's shape is
// auditable alongside the fixtures. Every line below is commented out. The live, runnable
// runner lives in the source repo's evals/ (`npm run eval`); it cannot execute from here
// regardless (no dist/, no agents, no spawn infrastructure in the catalog).
// ==========================================
//
// #!/usr/bin/env node
// // Runner for the LLM-judge behavioural eval (evals/CATALOG.md).
// //
// // Two depths, chosen per fixture by what its expected.toon pins:
// //
// //  • profile+plan only (no bands/discipline/recall) — the cheap bridge:
// //      inventory → monosashi-profiler (profile) → select-tracks → assert
// //  • judge layer (bands / discipline / evidenceMustCite pinned) — the full path:
// //      inventory + full-plan → monosashi-surveyor (profile + evidence, one read)
// //        → select-tracks → validate-evidence --resolve → monosashi-judge (pass A)
// //        → aggregate → assert (bands + discipline + recall)
// //
// // The judge path runs a single pass A (no second-opinion / tie-break) — enough to produce
// // mergedScores + a pass for the assertions; the reconciliation machinery is the real pipeline's,
// // not the eval skeleton's. Run from the repo root after `npm run build`:
// //
// //   node evals/run-eval.mjs            # every fixture under evals/fixtures/
// //   node evals/run-eval.mjs liar-agent # one fixture by name
// //
// // Outputs are written under evals/.out/<case>/.
//
// import { spawnSync } from "node:child_process";
// import { mkdirSync, existsSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
// import { join, resolve, dirname } from "node:path";
// import { fileURLToPath, pathToFileURL } from "node:url";
//
// const __dirname = dirname(fileURLToPath(import.meta.url));
// const root = resolve(__dirname, "..");
// const fixturesDir = join(__dirname, "fixtures");
// const outRoot = join(__dirname, ".out");
// const scripts = join(root, ".claude", "skills", "monosashi-eval", "scripts");
//
// // Compiled helpers (repo-only; not shipped). dist/ must exist — `npm run build` / `tsc` first.
// const distUrl = (f) => pathToFileURL(join(root, "dist", f)).href;
// let toonParse, toonStringify, readToonFile, evaluateFixture, assertEvalCase, caseNeedsJudge, assertActivation;
// try {
//   ({ toonParse, toonStringify, readToonFile } = await import(distUrl("serde.js")));
//   ({ evaluateFixture, assertEvalCase, caseNeedsJudge, assertActivation } = await import(distUrl("eval-assert.js")));
// } catch (e) {
//   console.error(`ERR run-eval: cannot load compiled helpers from dist/ — run \`npm run build\` first.\n  ${e.message}`);
//   process.exit(2);
// }
//
// const BUDGET_USD = process.env.MONOSASHI_EVAL_BUDGET ?? "1";
// const TIMEOUT_MS = Number(process.env.MONOSASHI_EVAL_TIMEOUT ?? 240_000);
// const MODEL = process.env.MONOSASHI_EVAL_MODEL ?? "sonnet";
// const QUERY_MODEL = process.env.MONOSASHI_EVAL_QUERY_MODEL ?? "haiku";
//
// /** Run a bundled tool (node scripts/<tool>.mjs ...), returning {ok, stdout, stderr}. */
// function runTool(tool, args) {
//   const r = spawnSync(process.execPath, [join(scripts, tool), ...args], {
//     cwd: root,
//     encoding: "utf8",
//     timeout: TIMEOUT_MS,
//   });
//   return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
// }
//
// /** Spawn one bundled agent headless: a one-shot `claude -p` session running AS <agent> (its
//  *  body.md is the system prompt), with the prompt on stdin (clean argv) and the Write tool
//  *  auto-accepted so it never blocks on a permission prompt. On Windows the `claude` launcher is
//  *  a `.cmd` shim Node won't exec without a shell — shell:true fixes that (our flag values are
//  *  space-free repo paths; the prompt is on stdin, clear of the shell line). */
// function spawnAgent(agent, prompt, addDirs) {
//   const flags = [
//     "-p",
//     "--agent", agent,
//     "--model", MODEL,
//     "--permission-mode", "acceptEdits",
//     ...addDirs.flatMap((d) => ["--add-dir", d]),
//     "--output-format", "json",
//     "--max-budget-usd", String(BUDGET_USD),
//   ];
//   const opts = { cwd: root, encoding: "utf8", timeout: TIMEOUT_MS, input: prompt };
//   const r = spawnSync("claude", flags, process.platform === "win32" ? { ...opts, shell: true } : opts);
//   return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status, error: r.error };
// }
//
// const CLAUDE_MISSING = "`claude` CLI not found on PATH — install Claude Code to run the spawn layer.";
//
// /** Cheap structural check on a written evidence pack: null if it parses with a non-empty `items`
//  *  array, else a one-line reason. Catches the common LLM-TOON slip of a bare `items:` (missing the
//  *  `[N]` count) before the full validate-evidence gate, so the surveyor can be re-emitted. */
// function evidenceParseError(path) {
//   if (!existsSync(path)) return "no evidence.toon written";
//   try {
//     const ev = readToonFile(path);
//     if (!Array.isArray(ev.items)) return "items is not an array (missing [N] count?)";
//     if (ev.items.length === 0) return "items is empty";
//     return null;
//   } catch (e) {
//     return `malformed TOON: ${e.message.slice(0, 120)}`;
//   }
// }
//
// /** Ingest an agent-authored artifact into canonical TOON, **in place**. The sub-agents emit JSON
//  *  per their body.md contract ("author JSON; `mono` converts it to canonical TOON" — see
//  *  `src/mono.ts` `ingest()`), so the eval harness must do the same conversion or it drifts from both
//  *  the agent contract and the production `mono next` pipeline (the drift that made a JSON profile
//  *  crash the runner). Parses the written file as JSON (the contract), falling back to TOON if a model
//  *  emitted TOON directly, strips a stray ``` fence, then rewrites the file as canonical TOON so every
//  *  downstream deterministic tool (validate-profile / select-tracks / validate-evidence / validate-pass)
//  *  reads one format. Returns `{ value }` on success or `{ error }` with a one-line reason. */
// function ingestAgentArtifact(path) {
//   if (!existsSync(path)) return { error: "not written" };
//   let raw = readFileSync(path, "utf8").trim();
//   const fence = raw.match(/^```[a-z]*\n([\s\S]*?)\n```$/i); // tolerate a ```json … ``` wrapper
//   if (fence) raw = fence[1].trim();
//   let value;
//   try {
//     value = JSON.parse(raw);
//   } catch {
//     try {
//       value = toonParse(raw); // a model that emitted TOON directly still ingests
//     } catch (e) {
//       return { error: `neither JSON nor TOON: ${(e.message ?? String(e)).slice(0, 140)}` };
//     }
//   }
//   writeFileSync(path, toonStringify(value) + "\n", "utf8");
//   return { value };
// }
//
// /** Spawn the split-mode profiler → writes profile.toon. (Cheap path: profile only.) */
// function runProfiler(artifactDir, inventoryPath, outProfile) {
//   const prompt =
//     `You are profiling one artifact bundle. Artifact path: ${artifactDir}\n` +
//     `Its inventory.toon is at: ${inventoryPath}\n` +
//     `Read the artifact files and the inventory, judge the four capability axes and declaredType ` +
//     `exactly per your contract, and use the Write tool to write the capability-profile **JSON** ` +
//     `(your body.md deliverable — author JSON, not hand-formatted TOON; the harness converts it to ` +
//     `canonical TOON, exactly as \`mono\` does in production) to EXACTLY this path: ${outProfile}\n` +
//     `Reply with only that path on a single line.`;
//   return spawnAgent("monosashi-profiler", prompt, [artifactDir, dirname(outProfile)]);
// }
//
// /** Spawn the surveyor → writes profile.toon AND evidence.toon in one read. (Full path.) */
// function runSurveyor(artifactDir, inventoryPath, fullPlanPath, outProfile, outEvidence, correction) {
//   const prompt =
//     `You are surveying one artifact bundle in a single read. Artifact path: ${artifactDir}\n` +
//     `Its inventory.toon is at: ${inventoryPath}\nIts full-plan.toon is at: ${fullPlanPath}\n` +
//     `Read each relevant file once; judge the four axes + declaredType, and gather candidate ` +
//     `evidence (line ranges) for every criterion in full-plan, exactly per your contract. ` +
//     `Use the Write tool to write the capability-profile **JSON** to EXACTLY ${outProfile} and the ` +
//     `evidence-pack **JSON** to EXACTLY ${outEvidence} — author JSON per your body.md contract (not ` +
//     `hand-formatted TOON); the harness converts each to canonical TOON, exactly as \`mono\` does in ` +
//     `production, so there are no TOON count/indentation rules for you to satisfy.\n` +
//     (correction ? `Your previous attempt FAILED validation — fix exactly this:\n${correction}\n` : "") +
//     `Reply with those two paths, one per line.`;
//   return spawnAgent("monosashi-surveyor", prompt, [artifactDir, dirname(outProfile)]);
// }
//
// /** Spawn the judge for one full pass A over the plan, scoring from the resolved evidence pack
//  *  without reopening the target → writes passA.toon. */
// function runJudge(artifactDir, planPath, evidencePath, outPass) {
//   const prompt =
//     `Score every criterion in the plan at ${planPath}. Your evidence pack is at ${evidencePath} ` +
//     `— judge from its candidates, cite them by evidenceRefs index, and do NOT reopen the target. ` +
//     `Quote the verbatim level wording the plan embeds. Use the Write tool to write your ScorePass ` +
//     `**JSON** (author JSON per your body.md contract; the harness converts it to canonical TOON, ` +
//     `exactly as \`mono\` does in production) to EXACTLY ${outPass}.\n` +
//     `Reply with only that path on a single line.`;
//   return spawnAgent("monosashi-judge", prompt, [artifactDir, dirname(outPass)]);
// }
//
// /** Run the pipeline for one fixture to the depth `needsJudge` asks for, returning the produced
//  *  artifacts (`{ profile, plan, pack?, passes?, mergedScores?, scoreboard? }`) or `{ error }`.
//  *  Shared by the white-box (expected.toon) and black-box (evals.json) frontends. */
// function runPipeline(name, needsJudge) {
//   const artifactDir = join(fixturesDir, name, "artifact");
//   if (!existsSync(artifactDir)) return { error: `no artifact/ in ${join(fixturesDir, name)}` };
//
//   const out = join(outRoot, name);
//   mkdirSync(out, { recursive: true });
//   const p = (f) => join(out, f);
//
//   // S0 — inventory (deterministic)
//   const inv = runTool("inventory.mjs", [artifactDir]);
//   if (!inv.ok) return { name, error: `inventory failed: ${inv.error?.message ?? inv.stderr.trim()}` };
//   writeFileSync(p("inventory.toon"), inv.stdout, "utf8");
//
//   // S1 — surveyor (full path: profile + evidence) or profiler (cheap path: profile only)
//   console.error(`  · spawning ${needsJudge ? "monosashi-surveyor" : "monosashi-profiler"} (${MODEL}) …`);
//   if (needsJudge) {
//     const fp = runTool("full-plan.mjs", []);
//     if (!fp.ok) return { name, error: `full-plan failed: ${fp.stderr.trim()}` };
//     writeFileSync(p("full-plan.toon"), fp.stdout, "utf8");
//   }
//   const spawnS1 = (correction) =>
//     needsJudge
//       ? runSurveyor(artifactDir, p("inventory.toon"), p("full-plan.toon"), p("profile.toon"), p("evidence.toon"), correction)
//       : runProfiler(artifactDir, p("inventory.toon"), p("profile.toon"));
//
//   // S1 → S2 → S2.6, wrapped in a bounded re-emit retry that mirrors the orchestrator's gate: an
//   // unparseable pack (missing `[N]` counts) or a hard validate-evidence error re-spawns the
//   // surveyor with the errors fed back. A re-emit rewrites profile + evidence, so profile/plan are
//   // re-derived each attempt (the deterministic tools are cheap). The profiler path runs once.
//   let profile, plan, spawn, correction;
//   for (let attempt = 1; attempt <= 2; attempt++) {
//     spawn = spawnS1(correction);
//     if (spawn.error?.code === "ENOENT") return { name, error: CLAUDE_MISSING };
//     if (!existsSync(p("profile.toon"))) {
//       if (attempt === 2) return { name, error: `S1 agent produced no profile.toon (status ${spawn.status}).\n  stderr: ${spawn.stderr.trim().slice(0, 400)}` };
//       correction = "You did not write the profile TOON to the required path.";
//       continue;
//     }
//     // Ingest the agent's JSON deliverable → canonical TOON before any TOON reader touches it (the
//     // agents emit JSON per contract; `mono` converts in production, so the eval must too).
//     const ingP = ingestAgentArtifact(p("profile.toon"));
//     if (ingP.error) {
//       if (attempt === 2) return { name, error: `S1 agent profile unparseable after retry: ${ingP.error}` };
//       console.error(`  · profile unparseable (attempt ${attempt}: ${ingP.error}) — re-emitting`);
//       correction = `Your profile did not parse (${ingP.error}). Emit ONE valid JSON document (schema in docs/schemas.md) — author JSON; the harness converts it to TOON.`;
//       continue;
//     }
//     const vp = runTool("validate-profile.mjs", [p("profile.toon")]); // S1.5 (warn-only)
//     if (!vp.ok) console.error(`  · validate-profile warning: ${vp.stderr.trim()}`);
//     profile = ingP.value;
//
//     // S2 (deterministic). Pass --inventory so the eval mirrors `mono next` exactly: select-tracks
//     // adopts inventory's path-derived `guessedDeclaredType` over the profiler's free-text guess
//     // (the declared-type authority). Without this the eval drifts from production — a bundle whose
//     // path convention disagrees with its frontmatter (e.g. a lone `*.agent.md`) would be scored on
//     // a declaredType the real pipeline never uses.
//     const sel = runTool("select-tracks.mjs", [p("profile.toon"), "--inventory", p("inventory.toon")]);
//     if (!sel.ok) return { name, error: `select-tracks failed: ${sel.stderr.trim()}` };
//     writeFileSync(p("plan.toon"), sel.stdout, "utf8");
//     plan = toonParse(sel.stdout);
//
//     if (!needsJudge) break; // profile + plan only — done
//
//     // Ingest the surveyor's JSON evidence pack → canonical TOON (same contract as the profile); a
//     // hard failure falls through to evidenceParseError below, which drives the re-emit retry.
//     ingestAgentArtifact(p("evidence.toon"));
//     const parseErr = evidenceParseError(p("evidence.toon"));
//     if (parseErr) {
//       if (attempt === 2) return { name, error: `surveyor evidence unparseable after retry: ${parseErr}` };
//       console.error(`  · evidence unparseable (attempt ${attempt}: ${parseErr}) — re-emitting surveyor`);
//       correction = `Your evidence pack did not parse (${parseErr}). Every array needs an explicit [N] count — write items[N]: and candidates[M]:, never bare items:.`;
//       continue;
//     }
//     // S2.6 — validate + resolve the evidence pack (ranges → snippets) against the subset plan
//     const ve = runTool("validate-evidence.mjs", [p("evidence.toon"), p("plan.toon"), "--target", artifactDir, "--superset", "--resolve", p("evidence.resolved.toon")]);
//     if (ve.ok) break;
//     if (attempt === 2) return { name, error: `validate-evidence failed after retry (pack quality): ${ve.stderr.trim()}` };
//     console.error(`  · evidence invalid (attempt ${attempt}) — re-emitting surveyor`);
//     correction = `Your evidence pack failed validation. Fix exactly these and re-emit valid TOON (explicit [N] counts; every candidate needs {path} + {lines}; line ranges must be in-range in the cited file; keep spans ≤ 30 lines):\n${ve.stderr.trim().slice(0, 600)}`;
//   }
//
//   const artifacts = { profile, plan };
//
//   if (needsJudge) {
//     // S3 — judge, one full pass A, scoring from the resolved pack
//     console.error(`  · spawning monosashi-judge (${MODEL}) …`);
//     const jr = runJudge(artifactDir, p("plan.toon"), p("evidence.resolved.toon"), p("passA.toon"));
//     if (jr.error?.code === "ENOENT") return { error: CLAUDE_MISSING };
//     if (!existsSync(p("passA.toon")))
//       return { error: `judge produced no passA.toon (status ${jr.status}).\n  stderr: ${jr.stderr.trim().slice(0, 400)}` };
//
//     // Ingest the judge's JSON pass → canonical TOON before validate-pass / aggregate read it.
//     const ingPass = ingestAgentArtifact(p("passA.toon"));
//     if (ingPass.error) return { error: `judge passA unparseable: ${ingPass.error}` };
//
//     // S3.5 — validate the pass (warn-only; we feed the RAW pass to discipline so a judge that
//     // emits an uncited high-confidence score is caught rather than auto-fixed away)
//     const vpass = runTool("validate-pass.mjs", [p("passA.toon"), p("plan.toon"), "--target", artifactDir, "--evidence", p("evidence.resolved.toon")]);
//     if (!vpass.ok) console.error(`  · validate-pass warning: ${vpass.stderr.trim()}`);
//
//     // S4 — aggregate (single pass A) → scoreboard with mergedScores
//     const agg = runTool("aggregate.mjs", ["--passA", p("passA.toon"), "--plan", p("plan.toon"), "--evidence", p("evidence.resolved.toon"), "--weighting", "internal"]);
//     if (!agg.ok) return { error: `aggregate failed: ${agg.stderr.trim()}` };
//     writeFileSync(p("scoreboard.toon"), agg.stdout, "utf8");
//     const scoreboard = toonParse(agg.stdout);
//
//     artifacts.pack = readToonFile(p("evidence.resolved.toon"));
//     artifacts.passes = [readToonFile(p("passA.toon"))];
//     artifacts.mergedScores = scoreboard.mergedScores ?? [];
//     artifacts.scoreboard = scoreboard;
//   }
//
//   return { artifacts };
// }
//
// /** White-box frontend: score one fixture's per-stage `expected.toon` via evaluateFixture. */
// /** Spawn a plain `claude -p` (no --agent, no tools) as a one-shot **skill router proxy**: given
//  *  the skill description + the queries, classify each as in-scope (trigger) or not. This tests the
//  *  description's scope clarity — a *proxy* for full multi-skill routing, not the real router. */
// function classifyQueries(description, items) {
//   const list = items.map((it, i) => `${i}. ${JSON.stringify(it.query)}`).join("\n");
//   const prompt =
//     `You are a skill router. Exactly ONE skill is available:\n` +
//     `  name: monosashi-eval\n  description: ${description}\n\n` +
//     `For EACH user message below, decide whether THIS skill is the appropriate one to handle it, ` +
//     `judging ONLY from the description's stated scope. trigger=true if it is, false otherwise.\n\n` +
//     `Messages:\n${list}\n\n` +
//     `Reply with ONLY a JSON array, one object per message in order: ` +
//     `[{"index":0,"trigger":true}, ...]. No prose, no code fence.`;
//   const flags = ["-p", "--model", QUERY_MODEL, "--output-format", "json", "--max-budget-usd", String(BUDGET_USD)];
//   const opts = { cwd: root, encoding: "utf8", timeout: TIMEOUT_MS, input: prompt };
//   const r = spawnSync("claude", flags, process.platform === "win32" ? { ...opts, shell: true } : opts);
//   if (r.error?.code === "ENOENT") return { error: CLAUDE_MISSING };
//   let text = r.stdout ?? "";
//   try { text = JSON.parse(text).result ?? text; } catch { /* not the json envelope; use raw */ }
//   const m = String(text).match(/\[[\s\S]*\]/);
//   if (!m) return { error: `router output unparseable: ${String(text).slice(0, 200)}` };
//   let arr;
//   try { arr = JSON.parse(m[0]); } catch (e) { return { error: `router JSON parse failed: ${e.message}` }; }
//   const byIndex = new Map(arr.filter((x) => x && Number.isInteger(x.index)).map((x) => [x.index, !!x.trigger]));
//   return { triggers: items.map((_, i) => (byIndex.has(i) ? byIndex.get(i) : null)) };
// }
//
// /** Activation eval: classify every query in eval_queries.json and assert each matches its label. */
// function runQueries(queriesPath) {
//   const q = JSON.parse(readFileSync(queriesPath, "utf8"));
//   const items = [
//     ...(q.should_trigger ?? []).map((query) => ({ query, expected: true })),
//     ...(q.should_not_trigger ?? []).map((query) => ({ query, expected: false })),
//   ];
//   console.error(`  · classifying ${items.length} queries via router proxy (${QUERY_MODEL}) …`);
//   const res = classifyQueries(q.descriptionUnderTest ?? "", items);
//   if (res.error) return { name: "eval_queries", error: res.error };
//   const checks = items.map((it, i) => assertActivation(it.query, it.expected, res.triggers[i]));
//   const failed = checks.filter((c) => !c.ok).length;
//   return { name: "eval_queries", result: { case: "eval_queries", checks, passed: checks.length - failed, failed, ok: failed === 0 } };
// }
//
// function runFixture(name) {
//   const expectedPath = join(fixturesDir, name, "expected.toon");
//   if (!existsSync(expectedPath)) return { name, error: `no expected.toon in ${join(fixturesDir, name)}` };
//   const expected = readToonFile(expectedPath);
//   const needsJudge = !!(expected.bands || expected.discipline || expected.evidenceMustCite);
//   const pipe = runPipeline(name, needsJudge);
//   if (pipe.error) return { name, error: pipe.error };
//   return { name, result: evaluateFixture(expected, pipe.artifacts) };
// }
//
// /** Black-box frontend: score one evals.json case via assertEvalCase over the produced scoreboard. */
// function runEvalsCase(c) {
//   const needsJudge = caseNeedsJudge(c);
//   const pipe = runPipeline(c.input.fixture, needsJudge);
//   if (pipe.error) return { name: c.name, error: pipe.error };
//   const a = pipe.artifacts;
//   return { name: c.name, result: assertEvalCase(c, { plan: a.plan, scoreboard: a.scoreboard, mergedScores: a.mergedScores, passes: a.passes }) };
// }
//
// function report(r) {
//   if (r.error) {
//     console.error(`\n✗ ${r.name}\n  ${r.error}`);
//     return false;
//   }
//   const { result } = r;
//   console.error(`\n${result.ok ? "✓" : "✗"} ${result.case}  (${result.passed}/${result.checks.length} checks)`);
//   for (const c of result.checks) console.error(`    ${c.ok ? "✓" : "✗"} ${c.check}: ${c.detail}`);
//   return result.ok;
// }
//
// const argv = process.argv.slice(2);
// const queriesIdx = argv.indexOf("--queries");
// const evalsIdx = argv.indexOf("--evals");
//
// if (queriesIdx !== -1) {
//   // Activation mode: classify eval_queries.json via the router proxy.
//   const next = argv[queriesIdx + 1];
//   const qPath = next && next.endsWith(".json")
//     ? next
//     : join(root, "skill-src", "monosashi-eval", "evals", "eval_queries.json");
//   if (!existsSync(qPath)) {
//     console.error(`ERR run-eval: eval_queries.json not found at ${qPath}`);
//     process.exit(2);
//   }
//   console.error(`run-eval --queries: ${qPath}`);
//   console.error(`\n▶ eval_queries (activation proxy)`);
//   process.exit(report(runQueries(qPath)) ? 0 : 1);
// }
//
// if (evalsIdx !== -1) {
//   // Black-box mode: score the skill's shipped evals.json end-to-end.
//   //   --evals                      all cases, default evals.json
//   //   --evals path/to/evals.json   all cases from that file (arg ending in .json)
//   //   --evals <fixture-or-name>    just the matching case(s)
//   const next = argv[evalsIdx + 1];
//   const evalsPath = next && next.endsWith(".json")
//     ? next
//     : join(root, "skill-src", "monosashi-eval", "evals", "evals.json");
//   if (!existsSync(evalsPath)) {
//     console.error(`ERR run-eval: evals.json not found at ${evalsPath}`);
//     process.exit(2);
//   }
//   const cases = JSON.parse(readFileSync(evalsPath, "utf8")).cases ?? [];
//   const only = next && !next.endsWith(".json") && !next.startsWith("-") ? next : undefined;
//   const run = only ? cases.filter((c) => c.name === only || c.input?.fixture === only) : cases;
//   console.error(`run-eval --evals: ${run.length} case(s) from ${evalsPath}`);
//   let allOk = true;
//   for (const c of run) {
//     console.error(`\n▶ ${c.name}`);
//     allOk = report(runEvalsCase(c)) && allOk;
//   }
//   process.exit(allOk ? 0 : 1);
// }
//
// // White-box mode (default): score each fixture's expected.toon.
// const onlyName = argv.find((a) => !a.startsWith("-"));
// const names = onlyName
//   ? [onlyName]
//   : existsSync(fixturesDir)
//     ? readdirSync(fixturesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
//     : [];
// if (names.length === 0) {
//   console.error("ERR run-eval: no fixtures found under evals/fixtures/");
//   process.exit(2);
// }
//
// console.error(`run-eval: ${names.length} fixture(s)`);
// let allOk = true;
// for (const n of names) {
//   console.error(`\n▶ ${n}`);
//   allOk = report(runFixture(n)) && allOk;
// }
// process.exit(allOk ? 0 : 1);
//
