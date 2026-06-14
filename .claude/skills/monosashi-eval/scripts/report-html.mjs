// report-html.ts — render a self-contained HTML report from a scoreboard.toon.
//
// Pure presentation: no scoring logic, no external assets, no client-side fetch.
// Everything (CSS + the radar chart as inline SVG computed server-side) is embedded
// so the produced file opens stand-alone in any browser. This is the §4 deliverable
// the `monosashi-conductor` hands to the user as the final artifact of a run.
//
// Design goal: an enterprise-grade scoreboard that anyone can read at a glance.
// The page leads with a maturity verdict (the overall mean placed on a named 0–4
// ladder, never a bare number), then the radar, then the full per-criterion detail —
// nothing is hidden, but the hierarchy goes summary → breakdown → evidence.
//
// The single export `renderHtml(sb)` takes the parsed scoreboard object (same shape
// `report.ts` consumes) and returns the full HTML document as a string.
import { RUBRIC } from "./rubric.mjs";
// Track id → label used inside the page. Short names keep the radar axes legible;
// the full rubric name is shown in the legend.
const TRACK_SHORT = {
    M: "メタ整合",
    G: "共通",
    A: "エージェント",
    S: "スキル",
    H: "ハーネス",
    K: "知識/doc",
};
const TRACK_ORDER = ["M", "G", "A", "S", "H", "K"];
// Criterion id → human-readable title / track / level ladder, drawn from the rubric (single
// source of truth) so a reader who doesn't know what "A1" or "K5" means gets the label inline.
const CRIT = {};
for (const tr of RUBRIC.tracks)
    for (const c of tr.criteria)
        CRIT[c.id] = { title: c.title, track: c.track, levels: c.levels };
// 0–4 scale name/meaning, so a coloured score badge is interpretable (Absent…Optimized).
const SCALE = {};
for (const s of RUBRIC.scale)
    SCALE[s.level] = { name: s.name, meaning: s.meaning };
// Track id → full name (for the radar legend).
const TRACK_NAME = {};
for (const tr of RUBRIC.tracks)
    TRACK_NAME[tr.id] = tr.name;
// Confidence label in Japanese, for the audience.
const CONF_LABEL = { high: "高", medium: "中", low: "低" };
function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function fmt(n) {
    if (n == null || Number.isNaN(n))
        return "N/A";
    return n.toFixed(2).replace(/\.?0+$/, "");
}
// Map a 0–4 score to a heat colour (red → amber → green).
function scoreColor(score) {
    if (typeof score !== "number" || Number.isNaN(score))
        return "#9aa0a6"; // N/A grey
    const stops = ["#c5221f", "#e8710a", "#f9ab00", "#5e9c3a", "#188038"]; // 0..4
    return stops[Math.max(0, Math.min(4, Math.round(score)))];
}
// The maturity band a mean falls into. The headline uses the nearest level name as a
// quick label; the ruler underneath shows the exact standing so it can't mislead.
function bandFor(mean) {
    if (mean == null || Number.isNaN(mean))
        return null;
    const lvl = Math.max(0, Math.min(4, Math.round(mean)));
    const s = SCALE[lvl] ?? { name: "?", meaning: "" };
    return { level: lvl, name: s.name, meaning: s.meaning, color: scoreColor(lvl) };
}
function trackRows(byTrack) {
    return TRACK_ORDER.filter((k) => byTrack?.[k]).map((k) => ({
        key: k,
        label: TRACK_SHORT[k] ?? k,
        mean: byTrack[k].mean,
        n: byTrack[k].n,
    }));
}
// Hero ruler: places the overall mean on the named 0–4 maturity ladder so a reader
// instantly sees "this is between Managed and Optimized", not just "3.68".
function maturityRuler(mean) {
    const has = typeof mean === "number" && !Number.isNaN(mean);
    const pct = has ? (Math.max(0, Math.min(4, mean)) / 4) * 100 : 0;
    const ticks = [0, 1, 2, 3, 4]
        .map((lvl) => {
        const s = SCALE[lvl];
        const left = (lvl / 4) * 100;
        const align = lvl === 0 ? "flex-start" : lvl === 4 ? "flex-end" : "center";
        const tx = lvl === 0 ? "translateX(0)" : lvl === 4 ? "translateX(-100%)" : "translateX(-50%)";
        return `<div class="rt" style="left:${left}%;align-items:${align};transform:${tx}">
          <span class="rt-lvl">${lvl}</span><span class="rt-name">${esc(s?.name ?? "")}</span>
        </div>`;
    })
        .join("");
    const marker = has
        ? `<div class="ruler-marker" style="left:${pct.toFixed(1)}%"><span class="ruler-bub">${esc(fmt(mean))}</span></div>`
        : "";
    return `<div class="ruler">
      <div class="ruler-bar">
        <span class="seg-line" style="left:25%"></span><span class="seg-line" style="left:50%"></span><span class="seg-line" style="left:75%"></span>
        ${marker}
      </div>
      <div class="ruler-ticks">${ticks}</div>
    </div>`;
}
// Server-side radar (spider) chart over the present tracks, 0–4 scale.
function radarSvg(rows) {
    const size = 360;
    const cx = size / 2;
    const cy = size / 2;
    const R = 118;
    const n = rows.length;
    if (n < 3)
        return ""; // a radar needs ≥3 axes; fewer tracks fall back to the table only
    const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pt = (value, i) => {
        const r = R * (Math.max(0, Math.min(4, value)) / 4);
        return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
    };
    const parts = [];
    // concentric grid rings at levels 1..4
    for (let lvl = 1; lvl <= 4; lvl++) {
        const ring = rows
            .map((_, i) => {
            const [x, y] = pt(lvl, i);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
            .join(" ");
        parts.push(`<polygon points="${ring}" fill="${lvl === 4 ? "#fafbfc" : "none"}" stroke="#e3e6ea" stroke-width="1"/>`);
    }
    // axis spokes + labels (track short name + score, so the axis is self-explaining)
    rows.forEach((row, i) => {
        const [x, y] = pt(4, i);
        parts.push(`<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#dadce0" stroke-width="1"/>`);
        const lx = cx + (R + 26) * Math.cos(angle(i));
        const ly = cy + (R + 26) * Math.sin(angle(i));
        const anchor = Math.abs(lx - cx) < 10 ? "middle" : lx > cx ? "start" : "end";
        parts.push(`<text x="${lx.toFixed(1)}" y="${(ly - 5).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="12.5" font-weight="700" fill="#202124">${esc(row.label)}</text>`, `<text x="${lx.toFixed(1)}" y="${(ly + 11).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="11" font-weight="600" fill="${scoreColor(row.mean)}">${esc(fmt(row.mean))}</text>`);
    });
    // data polygon
    const data = rows
        .map((r, i) => {
        const [x, y] = pt(r.mean ?? 0, i);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
        .join(" ");
    parts.push(`<polygon points="${data}" fill="rgba(26,115,232,0.16)" stroke="#1a73e8" stroke-width="2.5" stroke-linejoin="round"/>`);
    rows.forEach((r, i) => {
        const [x, y] = pt(r.mean ?? 0, i);
        parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#fff" stroke="#1a73e8" stroke-width="2"/>`);
    });
    return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="トラック別レーダーチャート">${parts.join("")}</svg>`;
}
// Horizontal bar (0–4) for a track/domain row.
function scoreBar(mean) {
    if (mean == null || Number.isNaN(mean))
        return `<span class="na">N/A</span>`;
    const pct = (Math.max(0, Math.min(4, mean)) / 4) * 100;
    return `<div class="track"><div class="fill" style="width:${pct.toFixed(0)}%;background:${scoreColor(mean)}"></div></div>`;
}
export function renderHtml(sb) {
    const o = sb.scoreboard ?? {};
    const rows = trackRows(o.radarByTrack ?? {});
    const domains = o.radarByDomain ?? {};
    const m2 = o.m2Flag ?? sb.m2Flag;
    const nhr = sb.needsHumanReview ?? o.needsHumanReview ?? [];
    const merged = sb.mergedScores ?? [];
    const prov = sb.provenance ?? {};
    const audit = sb.audit;
    const generatedNote = prov.producedAt ? esc(prov.producedAt) : "";
    const conf = o.confidence ?? {};
    const band = bandFor(o.overallMean);
    const scored = merged.length;
    // The target can be a single path or several artifacts joined with " + " (a composite bundle).
    // Render each as its own chip so a long concatenated string reads as a list, not one blob.
    const targetParts = String(sb.target ?? "?")
        .split(/\s*\+\s*/)
        .filter(Boolean);
    const targetHtml = targetParts.map((p) => `<span class="target">${esc(p)}</span>`).join("");
    // ---- per-criterion rows
    const criterionRows = merged
        .map((s) => {
        const ev = s.evidence ?? [];
        const evHtml = ev.length
            ? `<details><summary>${ev.length} 件の根拠</summary>${ev
                .map((e) => `<div class="ev"><code>${esc(e.path)}${e.lines ? `:${esc(e.lines)}` : ""}</code><pre>${esc(e.snippet)}</pre></div>`)
                .join("")}</details>`
            : `<span class="na">—</span>`;
        const passes = s.singlePass === true
            ? `<span class="pill single">単一パス</span>`
            : `<span class="pill multi">A${s.scoreA ?? "·"}/B${s.scoreB ?? "·"}${s.scoreC != null ? `/C${s.scoreC}` : ""}</span>`;
        const scoreStr = typeof s.score === "number" ? fmt(s.score) : esc(s.score);
        const info = CRIT[s.criterion];
        const lvl = typeof s.score === "number" ? SCALE[s.score] : undefined;
        const lvlName = lvl ? `<span class="slvl" title="${esc(lvl.meaning)}">${esc(lvl.name)}</span>` : "";
        const confKey = esc(s.confidence);
        return `<tr>
        <td class="crit"><span class="cid">${esc(s.criterion)}</span>${info ? `<span class="ctitle">${esc(info.title)}</span>` : ""}</td>
        <td class="scorecell"><span class="score" style="background:${scoreColor(s.score)}">${scoreStr}</span>${lvlName}</td>
        <td><span class="conf ${confKey}">${esc(CONF_LABEL[s.confidence] ?? s.confidence ?? "?")}</span></td>
        <td>${passes}</td>
        <td class="rationale">${esc(s.rationale)}</td>
        <td>${evHtml}</td>
      </tr>`;
    })
        .join("\n");
    // ---- domain rows
    const domainRows = Object.keys(domains)
        .sort((a, b) => (domains[b].mean ?? 0) - (domains[a].mean ?? 0))
        .map((d) => `<tr><td class="dname">${esc(d)}</td><td class="num">${esc(fmt(domains[d].mean))}</td><td class="barcell">${scoreBar(domains[d].mean)}</td><td class="num muted">${esc(domains[d].n)}</td></tr>`)
        .join("\n");
    // ---- M2 box
    const sevClass = m2?.divergent ? "warn" : "ok";
    const m2Html = m2
        ? `<section class="card m2 ${sevClass}">
        <div class="m2-head">
          <h2>M2 — 宣言↔実体の乖離</h2>
          <span class="m2-verdict">${m2.divergent ? "乖離あり" : "整合"} <span class="badge">スコア ${esc(m2.score)} / 3</span></span>
        </div>
        <p class="m2-meta"><span>重大度: <strong>${esc(m2.severity ?? "—")}</strong></span></p>
        ${m2.rationale ? `<p class="rationale">${esc(m2.rationale)}</p>` : ""}
        <p class="muted">宣言された種別と実体の構造軸を機械的に突合した独立フラグ。トラック平均には混入しません。</p>
      </section>`
        : "";
    // ---- needs-human-review
    const nhrHtml = nhr.length
        ? `<ul class="nhr">${nhr.map((x) => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}</ul>`
        : `<p class="ok-note">要確認の評価軸はありません。</p>`;
    // ---- audit trail — per-criterion judgement provenance: which passes scored it, by what
    // reconciliation method, on what evidence. `judgements` is an array ({pass,score,confidence})
    // and `evidence` an array ({path,lines}); render their fields, never the raw objects.
    const auditHtml = audit?.trail?.length
        ? `<section class="card"><h2>監査証跡</h2>
        <p class="muted">各評価軸を「どのパスが・どの根拠で・どう確定したか」の追跡ログ。A = パスA、B = セカンドオピニオン、C = タイブレーク。確定方法はスコアの決め方（single / median 等）。</p>
        <div class="tablewrap"><table class="grid">
        <thead><tr><th>評価軸</th><th>スコア</th><th>確定方法</th><th>各パス (pass=score/確信度)</th><th>根拠</th><th>要確認</th></tr></thead>
        <tbody>${audit.trail
            .map((t) => {
            const info = CRIT[t.criterion];
            const score = typeof t.finalScore === "number" ? fmt(t.finalScore) : esc(t.finalScore);
            const passes = Array.isArray(t.judgements)
                ? t.judgements
                    .map((j) => {
                    const sc = typeof j.score === "number" ? fmt(j.score) : esc(j.score);
                    return `${esc(j.pass)}=${sc}/${esc(CONF_LABEL[j.confidence] ?? j.confidence)}`;
                })
                    .join("  ")
                : "";
            const ev = Array.isArray(t.evidence) && t.evidence.length
                ? t.evidence.map((e) => `${esc(e.path)}${e.lines ? `:${esc(e.lines)}` : ""}`).join("<br>")
                : `<span class="na">—</span>`;
            return `<tr>
              <td class="crit"><span class="cid">${esc(t.criterion)}</span>${info ? `<span class="ctitle">${esc(info.title)}</span>` : ""}</td>
              <td class="scorecell"><span class="score" style="background:${scoreColor(typeof t.finalScore === "number" ? t.finalScore : null)}">${score}</span></td>
              <td>${esc(t.method ?? "")}</td>
              <td class="passcell">${passes}</td>
              <td class="evcell">${ev}</td>
              <td class="num">${t.needsHumanReview ? `<span class="warn-mark" title="パス間でスコア差 ≥ 2">⚠</span>` : ""}</td>
            </tr>`;
        })
            .join("")}</tbody></table></div></section>`
        : "";
    const radar = radarSvg(rows);
    const trackLegend = rows.length
        ? `<div class="legend">${rows
            .map((r) => `<span class="item"><strong>${esc(r.key)}</strong> ${esc(TRACK_NAME[r.key] ?? "")}</span>`)
            .join("")}</div>`
        : "";
    const scaleLegend = `<div class="scale-strip">${RUBRIC.scale
        .map((s) => `<span class="scale-item"><span class="sw" style="background:${scoreColor(s.level)}"></span><strong>${s.level} ${esc(s.name)}</strong><span class="sm">${esc(s.meaning)}</span></span>`)
        .join("")}</div>`;
    // Confidence split as a stacked bar (high/medium/low) — turns three raw counts into a glanceable ratio.
    const cHigh = conf.high ?? 0;
    const cMed = conf.medium ?? 0;
    const cLow = conf.low ?? 0;
    const cTot = cHigh + cMed + cLow || 1;
    const confBar = `<div class="confbar" role="img" aria-label="確信度の内訳 高${cHigh} 中${cMed} 低${cLow}">
      ${cHigh ? `<span class="seg high" style="width:${((cHigh / cTot) * 100).toFixed(1)}%" title="高 ${cHigh}"></span>` : ""}
      ${cMed ? `<span class="seg medium" style="width:${((cMed / cTot) * 100).toFixed(1)}%" title="中 ${cMed}"></span>` : ""}
      ${cLow ? `<span class="seg low" style="width:${((cLow / cTot) * 100).toFixed(1)}%" title="低 ${cLow}"></span>` : ""}
    </div>`;
    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monosashi 評価レポート — ${esc(sb.target ?? "?")}</title>
<style>
  :root {
    --fg:#1f2329; --muted:#5f6368; --faint:#80868b; --line:#e3e6ea; --bg:#fff;
    --card:#f6f8fa; --accent:#1a73e8; --page:#eef1f4;
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Hiragino Kaku Gothic ProN","Meiryo",sans-serif; color:var(--fg); background:var(--page); line-height:1.65; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1080px; margin:0 auto; padding:32px 24px 72px; }

  /* header */
  header.top { margin-bottom:24px; }
  .title-row { display:flex; flex-wrap:wrap; align-items:center; gap:10px 14px; }
  header.top h1 { font-size:20px; font-weight:700; margin:0; letter-spacing:.01em; }
  .chips { display:flex; gap:8px; flex-wrap:wrap; margin-left:auto; }
  .chip { background:var(--bg); border:1px solid var(--line); border-radius:999px; padding:3px 12px; font-size:12px; color:var(--muted); }
  .target-row { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px 12px; margin-top:12px; }
  .target-label { font-size:11px; font-weight:600; color:var(--faint); text-transform:uppercase; letter-spacing:.05em; flex:none; }
  .target-list { display:flex; flex-wrap:wrap; gap:6px; }
  .target { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; background:#262a30; color:#fff; padding:3px 10px; border-radius:6px; font-size:12.5px; word-break:break-all; }

  /* hero verdict */
  .hero { background:var(--bg); border:1px solid var(--line); border-radius:16px; padding:26px 30px; margin-bottom:22px; display:flex; flex-wrap:wrap; gap:28px 40px; align-items:center; }
  .hero-score { display:flex; align-items:baseline; gap:12px; flex:none; }
  .hero-score .big { font-size:62px; font-weight:800; line-height:.9; letter-spacing:-.02em; color:var(--fg); }
  .hero-score .denom { font-size:20px; color:var(--faint); font-weight:600; }
  .hero-band { margin-top:6px; }
  .band-chip { display:inline-block; color:#fff; font-weight:700; font-size:13px; border-radius:999px; padding:3px 12px; }
  .band-mean { display:block; font-size:12px; color:var(--muted); margin-top:6px; max-width:240px; }
  .hero-right { flex:1; min-width:300px; }
  .hero-label { font-size:12px; color:var(--faint); text-transform:uppercase; letter-spacing:.06em; font-weight:600; margin-bottom:14px; }

  /* maturity ruler */
  .ruler { margin-top:4px; }
  .ruler-bar { position:relative; height:14px; border-radius:8px; background:linear-gradient(90deg,#c5221f 0%,#e8710a 25%,#f9ab00 50%,#5e9c3a 75%,#188038 100%); }
  .seg-line { position:absolute; top:-3px; bottom:-3px; width:1px; background:rgba(255,255,255,.7); }
  .ruler-marker { position:absolute; top:-7px; bottom:-7px; width:3px; background:#1f2329; border-radius:2px; }
  .ruler-bub { position:absolute; top:-26px; left:50%; transform:translateX(-50%); background:#1f2329; color:#fff; font-size:12px; font-weight:700; padding:1px 7px; border-radius:5px; white-space:nowrap; }
  .ruler-ticks { position:relative; height:34px; margin-top:9px; }
  .rt { position:absolute; top:0; display:flex; flex-direction:column; line-height:1.25; }
  .rt-lvl { font-size:12px; font-weight:700; color:var(--fg); }
  .rt-name { font-size:10.5px; color:var(--faint); }

  /* KPI tiles */
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin-bottom:24px; }
  .kpi { background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .kpi .l { font-size:11px; color:var(--faint); text-transform:uppercase; letter-spacing:.05em; font-weight:600; }
  .kpi .v { font-size:28px; font-weight:700; line-height:1.15; margin-top:4px; }
  .kpi .v small { font-size:14px; color:var(--muted); font-weight:600; }
  .kpi .sub { font-size:11.5px; color:var(--muted); margin-top:3px; }
  .confbar { display:flex; height:12px; border-radius:6px; overflow:hidden; background:var(--card); margin-top:8px; }
  .confbar .seg { display:block; height:100%; }
  .confbar .seg.high { background:#188038; } .confbar .seg.medium { background:#f9ab00; } .confbar .seg.low { background:#c5221f; }
  .conf-key { display:flex; gap:12px; font-size:11px; color:var(--muted); margin-top:6px; }
  .conf-key i { font-style:normal; } .conf-key .d { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:4px; vertical-align:middle; }

  /* cards & layout */
  .cols { display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start; margin-bottom:22px; }
  .card { background:var(--bg); border:1px solid var(--line); border-radius:14px; padding:22px 26px; margin-bottom:22px; }
  .card > h2 { font-size:15px; font-weight:700; margin:0 0 16px; display:flex; align-items:center; gap:8px; }
  .radar-card { flex:1.1; min-width:340px; margin-bottom:0; text-align:center; }
  .radar-card svg { display:block; width:100%; max-width:340px; height:auto; margin:0 auto; }
  .domain-card { flex:1; min-width:320px; margin-bottom:0; }

  table { border-collapse:collapse; width:100%; font-size:13px; }
  .tablewrap { overflow-x:auto; }
  table.grid th, table.grid td { border-bottom:1px solid var(--line); padding:9px 10px; text-align:left; vertical-align:top; }
  table.grid thead th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--faint); font-weight:600; background:var(--card); }
  table.grid tbody tr:hover { background:#fbfcfd; }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  td.barcell { width:46%; }
  .dname { font-weight:600; }
  .track { background:var(--card); border-radius:6px; height:9px; overflow:hidden; }
  .track .fill { height:100%; border-radius:6px; }

  .crit .cid { display:block; font-weight:700; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; white-space:nowrap; }
  .crit .ctitle { display:block; font-size:11px; font-weight:400; color:var(--muted); margin-top:2px; max-width:230px; white-space:normal; line-height:1.4; }
  .scorecell { text-align:center; white-space:nowrap; }
  .score { display:inline-block; min-width:32px; text-align:center; color:#fff; font-weight:700; border-radius:6px; padding:2px 7px; }
  .slvl { display:block; font-size:10px; color:var(--muted); margin-top:3px; }
  .passcell { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; white-space:nowrap; }
  .evcell { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; color:var(--accent); word-break:break-all; }

  /* scale reference strip */
  .scale-strip { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
  .scale-item { display:flex; align-items:center; gap:6px; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:5px 10px; font-size:11px; color:var(--muted); }
  .scale-item .sw { width:11px; height:11px; border-radius:3px; flex:none; }
  .scale-item strong { color:var(--fg); font-size:11.5px; }
  .scale-item .sm { color:var(--faint); }

  .legend { display:flex; flex-wrap:wrap; gap:6px 16px; margin-top:14px; font-size:11.5px; justify-content:center; }
  .legend .item { color:var(--muted); }
  .legend .item strong { color:var(--accent); font-family:ui-monospace,monospace; margin-right:2px; }

  .conf { font-size:11px; padding:2px 9px; border-radius:999px; font-weight:600; }
  .conf.high { background:#e6f4ea; color:#188038; }
  .conf.medium { background:#fef7e0; color:#b06000; }
  .conf.low { background:#fce8e6; color:#c5221f; }
  .pill { font-size:11px; padding:2px 8px; border-radius:6px; background:var(--card); color:var(--muted); font-family:ui-monospace,monospace; white-space:nowrap; }
  .pill.single { background:#eef1ff; color:#3b5bdb; font-family:inherit; }
  td.rationale, p.rationale { color:#3c4043; }
  td.rationale { max-width:360px; }
  .ev code { display:block; font-size:11px; color:var(--accent); margin:8px 0 2px; word-break:break-all; }
  .ev pre { background:#1f2329; color:#e6e6e6; padding:10px 12px; border-radius:8px; overflow:auto; font-size:11px; max-height:240px; margin:0; white-space:pre-wrap; }
  details summary { cursor:pointer; color:var(--accent); font-size:12px; }

  /* M2 box */
  .m2 { border-width:1px; border-style:solid; }
  .m2.warn { background:#fff8e6; border-color:#fdd663; }
  .m2.ok { background:#e9f5ec; border-color:#a8dab5; }
  .m2-head { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:8px; }
  .m2-head h2 { margin:0; font-size:15px; }
  .m2-verdict { margin-left:auto; font-weight:700; font-size:13px; }
  .m2 .badge { font-size:12px; font-weight:600; background:#fff; border:1px solid var(--line); border-radius:999px; padding:2px 10px; margin-left:6px; }
  .m2-meta { margin:2px 0 8px; font-size:13px; }
  .warn-mark { color:#b06000; }

  .nhr { margin:0; padding-left:20px; }
  .nhr li { margin:3px 0; }
  .ok-note { color:#188038; font-size:13px; margin:0; }

  .muted { color:var(--muted); font-size:12px; }
  .na { color:#9aa0a6; }
  footer { margin-top:32px; padding-top:18px; border-top:1px solid var(--line); font-size:12px; color:var(--muted); }
  footer code { font-family:ui-monospace,monospace; }
  footer p { margin:4px 0; }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="title-row">
      <h1>Monosashi 評価レポート</h1>
      <div class="chips">
        ${sb.declaredType ? `<span class="chip">宣言種別: ${esc(sb.declaredType)}</span>` : ""}
        ${sb.twoPass != null ? `<span class="chip">${sb.twoPass ? "2パス採点" : "単一パス採点"}</span>` : ""}
        ${prov.toolVersion ? `<span class="chip">ツール v${esc(prov.toolVersion)}</span>` : ""}
      </div>
    </div>
    <div class="target-row">
      <span class="target-label">評価対象${targetParts.length > 1 ? `（${targetParts.length} 成果物）` : ""}</span>
      <div class="target-list">${targetHtml}</div>
    </div>
  </header>

  <section class="hero">
    <div>
      <div class="hero-score">
        <span class="big">${esc(fmt(o.overallMean))}</span>
        <span class="denom">/ 4.0</span>
      </div>
      <div class="hero-band">
        ${band ? `<span class="band-chip" style="background:${band.color}">Lv${band.level} ${esc(band.name)}</span><span class="band-mean">${esc(band.meaning)}</span>` : `<span class="muted">スコアなし</span>`}
      </div>
    </div>
    <div class="hero-right">
      <div class="hero-label">総合成熟度（全評価軸の平均）</div>
      ${maturityRuler(o.overallMean)}
    </div>
  </section>

  <div class="kpis">
    <div class="kpi">
      <div class="l">加重指数</div>
      <div class="v">${esc(fmt(o.weightedIndex))}<small> / 4.0</small></div>
      <div class="sub">weighting: ${esc(o.weighting ?? "?")}（重み付き総合スコア）</div>
    </div>
    <div class="kpi">
      <div class="l">評価軸</div>
      <div class="v">${esc(scored)}<small> 軸</small></div>
      <div class="sub">N/A（対象外）: ${esc(o.naCount ?? 0)} 軸</div>
    </div>
    <div class="kpi">
      <div class="l">判定の確信度</div>
      <div class="v" style="font-size:20px">高 ${esc(cHigh)} ・ 中 ${esc(cMed)} ・ 低 ${esc(cLow)}</div>
      ${confBar}
      <div class="conf-key"><i><span class="d" style="background:#188038"></span>高</i><i><span class="d" style="background:#f9ab00"></span>中</i><i><span class="d" style="background:#c5221f"></span>低</i></div>
    </div>
  </div>

  <div class="cols">
    <div class="card radar-card">
      <h2>トラック別レーダー</h2>
      ${radar || `<p class="muted">トラックが3未満のため表のみ表示</p>`}
      ${trackLegend}
    </div>
    <div class="card domain-card">
      <h2>ドメイン別スコア</h2>
      <table class="grid"><thead><tr><th>ドメイン</th><th class="num">平均</th><th>　</th><th class="num">軸数</th></tr></thead>
      <tbody>${domainRows}</tbody></table>
    </div>
  </div>

  ${m2Html}

  <section class="card">
    <h2>要人間確認</h2>
    ${nhrHtml}
  </section>

  <section class="card">
    <h2>評価軸別スコア</h2>
    ${scaleLegend}
    <div class="tablewrap"><table class="grid">
      <thead><tr><th>評価軸</th><th>スコア</th><th>確信度</th><th>パス</th><th>判定理由</th><th>根拠</th></tr></thead>
      <tbody>${criterionRows}</tbody>
    </table></div>
  </section>

  ${auditHtml}

  <footer>
    <p>runId <code>${esc(prov.runId ?? "—")}</code> ・ producedBy <code>${esc(prov.producedBy ?? "—")}</code>${generatedNote ? ` ・ ${generatedNote}` : ""}</p>
    <p>静的・根拠ベースの Monosashi 採点です。実行時の振る舞い（成功率・レイテンシ・コスト）は対象外。M2 は機械的・独立の乖離フラグです。</p>
  </footer>
</div>
</body>
</html>`;
}
