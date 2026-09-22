import { branchOf } from "./engine.js";

// Small hand-rolled SVG charts for the Analytics tab. Colours come from the page's CSS variables, so the charts
// follow light/dark mode. Every mark has a <title> so values are readable on hover.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const DISP = [["auto", "Automated"], ["human", "Human review"], ["block", "Blocked"]];

export function kpis(el, runs) {
  const n = runs.length;
  const c = { auto: 0, human: 0, block: 0 };
  for (const r of runs) c[r.outcome.disposition]++;
  const decs = runs.flatMap((r) => r.steps.filter((s) => s.kind === "decision"));
  const lat = runs.filter((r) => r.source === "model").map((r) => r.totalMs);
  const tile = (l, v, sub = "") => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}${sub ? ` <small>${sub}</small>` : ""}</div></div>`;
  el.innerHTML = [
    tile("Runs", n),
    tile("Automated", n ? pct(c.auto / n) : "–", n ? `${c.auto}` : ""),
    tile("Human review", n ? pct(c.human / n) : "–", n ? `${c.human}` : ""),
    tile("Blocked", n ? pct(c.block / n) : "–", n ? `${c.block}` : ""),
    tile("Decisions made", decs.length),
    tile("Avg model latency", lat.length ? (lat.reduce((a, b) => a + b, 0) / lat.length / 1000).toFixed(1) : "–", lat.length ? "s / run" : ""),
  ].join("");
}

/**
 * Stacked area: share of runs ending automated / human / blocked at each threshold.
 * `series` = [{ t, auto, human, block, n }] (computed by the caller via replayAt).
 */
export function sweepChart(el, series, threshold) {
  if (!series.length || !series.some((s) => s.n)) { el.innerHTML = empty("Run a few cases to see how the threshold trades automation for review."); return; }
  const W = 520, H = 246, m = { l: 36, r: 10, t: 8, b: 42 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const x = (t) => m.l + ((t - t0) / (t1 - t0)) * iw, y = (v) => m.t + ih - v * ih;
  const frac = series.map((s) => ({ t: s.t, n: s.n, a: s.n ? s.auto / s.n : 0, h: s.n ? s.human / s.n : 0, b: s.n ? s.block / s.n : 0 }));
  // stack order bottom->top: auto, human, block
  const layer = (lo, hi) => {
    const top = frac.map((f) => `${x(f.t).toFixed(1)},${y(hi(f)).toFixed(1)}`);
    const bot = frac.slice().reverse().map((f) => `${x(f.t).toFixed(1)},${y(lo(f)).toFixed(1)}`);
    return `M${top.join("L")}L${bot.join("L")}Z`;
  };
  const areas = [
    ["auto", layer(() => 0, (f) => f.a)], ["human", layer((f) => f.a, (f) => f.a + f.h)], ["block", layer((f) => f.a + f.h, (f) => f.a + f.h + f.b)],
  ];
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((v) => `<g class="axis"><line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke-dasharray="${v ? "2 3" : ""}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${pct(v)}</text></g>`).join("");
  const ticksX = frac.filter((_, i) => i % 4 === 0).map((f) => `<text x="${x(f.t)}" y="${m.t + ih + 16}" text-anchor="middle">${f.t.toFixed(2)}</text>`).join("");
  const cur = frac.reduce((best, f) => (Math.abs(f.t - threshold) < Math.abs(best.t - threshold) ? f : best), frac[0]);
  const bw = iw / (frac.length - 1);
  const hover = frac.map((f) => `<rect x="${x(f.t) - bw / 2}" y="${m.t}" width="${bw}" height="${ih}" fill="transparent"><title>threshold ${f.t.toFixed(2)} (${f.n} runs)\nautomated ${pct(f.a)} · human ${pct(f.h)} · blocked ${pct(f.b)}</title></rect>`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Outcome share by confidence threshold">
    ${ticksY}
    ${areas.map(([k, d]) => `<path d="${d}" fill="var(--${k})" fill-opacity="0.78" stroke="var(--card)" stroke-width="1"/>`).join("")}
    <line x1="${x(threshold)}" x2="${x(threshold)}" y1="${m.t}" y2="${m.t + ih}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="4 3"/>
    <text x="${Math.min(x(threshold) + 4, W - 120)}" y="${m.t + 12}" style="fill:var(--ink);font-weight:600">now ${threshold.toFixed(2)}: ${pct(cur.a)} automated</text>
    ${ticksX}
    <text x="${m.l + iw / 2}" y="${H - 4}" text-anchor="middle">threshold (branch probability)</text>
    ${hover}
  </svg>${legend()}`;
}

/** Strip plot: one row per decision node, one dot per run answer, threshold marker per row. */
export function confChart(el, wf, runs, threshold) {
  const rows = Object.entries(wf.nodes).filter(([, n]) => n.type === "decision");
  const pts = [];
  for (const r of runs) {
    const pool = { ...(r.allAnswers || {}), ...r.answers };
    const visited = new Set(r.steps.map((s) => s.nodeId));
    rows.forEach(([id, n], ri) => { const a = pool[id]; if (!a) return; const b = branchOf(n, a); pts.push({ ri, id, c: b.p, visited: visited.has(id), sel: b.selected, text: r.input.text }); });
  }
  if (!pts.length) { el.innerHTML = empty("No decisions recorded for this workflow yet."); return; }
  const rowH = 34, W = 520, m = { l: 150, r: 12, t: 6, b: 26 }, H = m.t + rows.length * rowH + m.b, iw = W - m.l - m.r;
  const x = (c) => m.l + c * iw;
  const jitter = (i) => ((i * 7919) % 17) / 17 - 0.5;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<g class="axis"><line x1="${x(v)}" x2="${x(v)}" y1="${m.t}" y2="${H - m.b}" stroke-dasharray="2 3"/><text x="${x(v)}" y="${H - 8}" text-anchor="middle">${v}</text></g>`).join("");
  const labels = rows.map(([id, n], ri) => {
    const thr = n.minConfidence ?? threshold, yy = m.t + ri * rowH + rowH / 2;
    return `<text x="${m.l - 8}" y="${yy + 4}" text-anchor="end" style="fill:var(--ink)">${esc((n.label || id).slice(0, 24))}</text>
      <line x1="${x(thr)}" x2="${x(thr)}" y1="${yy - rowH / 2 + 3}" y2="${yy + rowH / 2 - 3}" stroke="var(--human)" stroke-width="2"><title>threshold ${thr.toFixed(2)}${n.minConfidence != null ? " (node override)" : ""}</title></line>`;
  }).join("");
  const dots = pts.map((p, i) => {
    const thr = wf.nodes[p.id].minConfidence ?? threshold;
    const yy = m.t + p.ri * rowH + rowH / 2 + jitter(i) * (rowH - 12);
    const col = p.c < thr ? "var(--human)" : "var(--decision)";
    return `<circle cx="${x(p.c).toFixed(1)}" cy="${yy.toFixed(1)}" r="${p.visited ? 4.5 : 3}" fill="${col}" fill-opacity="${p.visited ? 0.85 : 0.35}" stroke="var(--card)" stroke-width="1"><title>${esc(String(p.sel))} · branch p ${p.c.toFixed(3)}${p.visited ? "" : " (answered in batch, not on the path)"}\n${esc(p.text.slice(0, 90))}</title></circle>`;
  }).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Confidence per decision node">${grid}${labels}${dots}</svg>
    <div class="legendrow"><span><i style="background:var(--decision)"></i>at or above threshold</span><span><i style="background:var(--human)"></i>below threshold</span><span>faint dots: answered in the batch but off the path taken</span></div>`;
}

/** Horizontal stacked bars: outcome counts per workflow. */
export function mixChart(el, workflows, runs) {
  const rows = workflows.map((w) => {
    const rs = runs.filter((r) => r.workflowId === w.id);
    const c = { auto: 0, human: 0, block: 0 }; rs.forEach((r) => c[r.outcome.disposition]++);
    return { name: w.name, n: rs.length, c };
  }).filter((r) => r.n);
  if (!rows.length) { el.innerHTML = empty("No runs yet."); return; }
  const rowH = 26, W = 900, m = { l: 190, r: 40, t: 4, b: 4 }, H = m.t + rows.length * rowH + m.b, iw = W - m.l - m.r;
  const max = Math.max(...rows.map((r) => r.n));
  const bars = rows.map((r, i) => {
    let x0 = m.l; const yy = m.t + i * rowH + 4, h = rowH - 8;
    const segs = DISP.map(([k, lab]) => {
      const w = (r.c[k] / max) * iw; const s = w > 0 ? `<rect x="${x0}" y="${yy}" width="${w}" height="${h}" fill="var(--${k})" fill-opacity="0.85" rx="3"><title>${esc(r.name)}: ${lab} ${r.c[k]} of ${r.n}</title></rect>` : "";
      x0 += w; return s;
    }).join("");
    return `<text x="${m.l - 8}" y="${yy + h / 2 + 4}" text-anchor="end" style="fill:var(--ink)">${esc(r.name)}</text>${segs}<text x="${x0 + 6}" y="${yy + h / 2 + 4}">${r.n}</text>`;
  }).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Outcomes by workflow">${bars}</svg>${legend()}`;
}

const legend = () => `<div class="legendrow">${DISP.map(([k, l]) => `<span><i style="background:var(--${k})"></i>${l}</span>`).join("")}</div>`;
const empty = (msg) => `<p class="hint" style="padding:24px 4px">${esc(msg)}</p>`;
