// Graph views, drawn with Cytoscape.js + the dagre layout (both vendored, loaded as globals by index.html).
//   renderDiagram  the workflow DAG; runs are overlaid as a lit path with probability mass on each branch
//   renderTree     one run, every decision expanded into all its options (size = probability)
//   renderOntology the TBox/ABox graph from ontology.js
import { edgesOf, optionKeys, optionLabel, parseRange, routeKeyForOption, LOW } from "./engine.js";

const cytoscape = globalThis.cytoscape;
if (cytoscape && globalThis.cytoscapeDagre && !cytoscape.__dagre) { cytoscape.use(globalThis.cytoscapeDagre); cytoscape.__dagre = true; }

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export function palette() {
  const n = ["bg", "card", "ink", "ink2", "ink3", "line", "soft", "accent", "accent-soft", "decision", "decision-soft", "task", "task-soft",
    "auto", "auto-soft", "human", "human-soft", "block", "block-soft", "klass", "klass-soft", "case", "run"];
  return Object.fromEntries(n.map((k) => [k.replace(/-(\w)/g, (_, c) => c.toUpperCase()), css("--" + k)]));
}

const pct = (p) => `${Math.round(p * 100)}%`;
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---- tooltip -----------------------------------------------------------------------------
let tipEl = null;
function tip(cy) {
  if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tip"; tipEl.hidden = true; document.body.appendChild(tipEl); }
  cy.on("mouseover", "node, edge", (e) => { const t = e.target.data("tip"); if (!t) return; tipEl.textContent = t; tipEl.hidden = false; });
  cy.on("mousemove", (e) => { if (tipEl.hidden || !e.originalEvent) return; tipEl.style.left = e.originalEvent.clientX + 12 + "px"; tipEl.style.top = e.originalEvent.clientY + 12 + "px"; });
  cy.on("mouseout", "node, edge", () => { tipEl.hidden = true; });
}

function baseStyle(P) {
  return [
    { selector: "node", style: {
      label: "data(label)", "text-wrap": "wrap", "text-max-width": 130, "font-size": 11, color: P.ink, "text-valign": "center", "text-halign": "center",
      "background-color": P.card, "border-width": 1.5, "border-color": P.line, "font-family": "system-ui, sans-serif", "transition-property": "opacity, border-width, background-color", "transition-duration": "200ms" } },
    { selector: "edge", style: {
      width: 1.6, "line-color": P.ink3, "target-arrow-color": P.ink3, "target-arrow-shape": "triangle", "arrow-scale": 0.9, "curve-style": "bezier",
      label: "data(label)", "font-size": 10, color: P.ink2, "text-background-color": P.bg, "text-background-opacity": 0.92, "text-background-padding": 2,
      "text-rotation": "none", "transition-property": "opacity, line-color, width", "transition-duration": "200ms" } },
    { selector: ".dim", style: { opacity: 0.28 } },
  ];
}

// ---- workflow diagram --------------------------------------------------------------------

function routeLabel(node, key) {
  const q = node.question;
  if (key === LOW) return "low confidence";
  if (q.type === "noul") return key === "true" ? "yes" : "no";
  if (q.type === "score") {
    const [lo, hi] = parseRange(key) || [0, 0];
    const top = Math.min(hi, q.criteria.length - 1);
    return lo === top ? q.criteria[lo] : `${q.criteria[lo]} – ${q.criteria[top]}`;
  }
  return key;
}
const QT = { choice: "choice", score: "score", noul: "yes / no" };

function diagramElements(wf) {
  const els = [{ data: { id: "__trigger", label: `▶ ${wf.entity || "Input"}`, tip: "Trigger: a new " + (wf.entity || "input") + " arrives" }, classes: "trigger" }];
  for (const [id, n] of Object.entries(wf.nodes)) {
    if (n.type === "decision") {
      const label = `${trunc(n.label || n.question.instructions, 44)}\n〈${QT[n.question.type]}〉`;
      els.push({ data: { id, label, base: label, tip: `${n.question.instructions}\nOptions: ${optionKeys(n.question).map((k) => optionLabel(n.question, k)).join(", ")}` }, classes: "decision" });
    } else if (n.type === "task") {
      const label = `${n.channel ? n.channel.toUpperCase() + " · " : ""}${n.label}`;
      els.push({ data: { id, label, base: label, tip: n.template || n.label }, classes: "task" });
    } else {
      els.push({ data: { id, label: n.label, base: n.label, tip: `Outcome: ${n.label} (${n.disposition})${n.detail ? "\n" + n.detail : ""}` }, classes: `outcome ${n.disposition}` });
    }
  }
  els.push({ data: { id: "__trigger->" + wf.start, source: "__trigger", target: wf.start, label: "" }, classes: "next" });
  for (const e of edgesOf(wf)) {
    const node = wf.nodes[e.from];
    const label = e.kind === "route" || e.kind === "low" ? routeLabel(node, e.key) : "";
    els.push({ data: { id: `${e.from}->${e.to}::${e.key}`, source: e.from, target: e.to, label, base: label, key: e.key }, classes: e.kind });
  }
  return els;
}

function diagramStyle(P) {
  return [
    ...baseStyle(P),
    { selector: ".trigger", style: { shape: "round-rectangle", width: 120, height: 34, "background-color": P.accentSoft, "border-color": P.accent, "border-width": 2, "font-weight": 600 } },
    { selector: ".decision", style: { shape: "diamond", width: 170, height: 104, "background-color": P.decisionSoft, "border-color": P.decision, "border-width": 2, "text-max-width": 104, "font-size": 10.5 } },
    { selector: ".task", style: { shape: "round-rectangle", width: 168, height: 44, "background-color": P.taskSoft, "border-color": P.task, "text-max-width": 150, "font-size": 10.5 } },
    { selector: ".outcome", style: { shape: "round-rectangle", width: 150, height: 40, "border-width": 2.5, "font-weight": 600, "text-max-width": 136 } },
    { selector: ".outcome.auto", style: { "background-color": P.autoSoft, "border-color": P.auto } },
    { selector: ".outcome.human", style: { "background-color": P.humanSoft, "border-color": P.human } },
    { selector: ".outcome.block", style: { "background-color": P.blockSoft, "border-color": P.block } },
    { selector: "edge.low", style: { "line-style": "dashed", "line-color": P.human, "target-arrow-color": P.human, color: P.human } },
    { selector: "node.visited", style: { "border-width": 4, "underlay-color": P.accent, "underlay-opacity": 0.14, "underlay-padding": 6 } },
    { selector: "node.current", style: { "underlay-opacity": 0.3, "underlay-padding": 10 } },
    { selector: "edge.taken", style: { width: 4, "line-color": P.accent, "target-arrow-color": P.accent, color: P.ink, "font-weight": 700, "z-index": 10 } },
    { selector: "edge.taken.low", style: { "line-color": P.human, "target-arrow-color": P.human } },
    { selector: "edge.mass", style: { width: "data(w)" } },
    { selector: "edge.traffic", style: { width: "data(tw)", "line-color": P.accent, "target-arrow-color": P.accent, opacity: "data(to)" } },
  ];
}

/** Render (or re-render) a workflow diagram. Returns the cy instance. */
export function renderDiagram(container, wf, { rankDir = "TB" } = {}) {
  const P = palette();
  const cy = cytoscape({ container, elements: diagramElements(wf), style: diagramStyle(P), wheelSensitivity: 0.25, minZoom: 0.2, maxZoom: 2.5, boxSelectionEnabled: false, autoungrabify: false });
  runLayout(cy, { name: "dagre", rankDir, nodeSep: 34, rankSep: rankDir === "TB" ? 46 : 70, edgeSep: 12 });
  tip(cy);
  cy.__wf = wf;
  return cy;
}

/** Clear any run overlay. */
export function clearOverlay(cy) {
  cy.batch(() => {
    cy.elements().removeClass("visited current taken dim mass traffic").removeStyle("opacity");
    cy.nodes().forEach((n) => { if (n.data("base") !== undefined) n.data("label", n.data("base")); });
    cy.edges().forEach((e) => { if (e.data("base") !== undefined) e.data("label", e.data("base")); });
  });
}

/** Light up the path a run took; `upto` limits it to the first N steps (for step-by-step animation). */
export function overlayRun(cy, run, upto = Infinity) {
  const wf = cy.__wf;
  clearOverlay(cy);
  if (!run) return;
  const steps = run.steps.slice(0, upto);
  cy.batch(() => {
    cy.elements().addClass("dim");
    const lit = (el) => el.removeClass("dim");
    lit(cy.$id("__trigger").addClass("visited"));
    lit(cy.$id("__trigger->" + wf.start).addClass("taken"));
    steps.forEach((s, i) => {
      const n = cy.$id(s.nodeId); lit(n.addClass("visited"));
      if (i === steps.length - 1 && steps.length < run.steps.length) n.addClass("current");
      if (s.kind === "decision") {
        n.data("label", `${n.data("base")}\n${s.selectedLabel} · conf ${s.confidence.toFixed(2)}`);
        n.outgoers("edge").forEach((e) => {
          const key = e.data("key");
          const m = key === LOW ? null : s.routeMass[key] ?? 0;
          if (m != null) { e.data("label", `${e.data("base")} · ${pct(m)}`); e.data("w", 1.2 + 6 * m); e.addClass("mass"); lit(e); e.style("opacity", 0.35 + 0.65 * m); }
          if (key === s.routeKey && e.data("target") === s.to) { e.addClass("taken"); e.style("opacity", 1); }
          if (key === LOW) { e.data("label", s.lowConfidence ? `low confidence (${s.confidence.toFixed(2)} < ${s.threshold.toFixed(2)})` : e.data("base")); lit(e); e.style("opacity", s.lowConfidence ? 1 : 0.5); }
        });
      } else if (s.kind === "task") {
        n.outgoers("edge").forEach((e) => { lit(e); e.addClass("taken"); });
      }
    });
    // unvisited nodes stay dimmed; edges to them that carried mass are already styled
  });
}

/** Overlay aggregate traffic from many runs: edge width = how often that edge was taken. */
export function overlayTraffic(cy, runs) {
  clearOverlay(cy);
  if (!runs.length) return;
  const edgeCount = {}, nodeCount = {};
  for (const r of runs) {
    let prev = "__trigger";
    for (const s of r.steps) {
      const key = prev === "__trigger" ? `__trigger->${s.nodeId}` : null;
      if (key) edgeCount[key] = (edgeCount[key] || 0) + 1;
      nodeCount[s.nodeId] = (nodeCount[s.nodeId] || 0) + 1;
      if (s.kind === "decision") edgeCount[`${s.nodeId}->${s.to}::${s.routeKey}`] = (edgeCount[`${s.nodeId}->${s.to}::${s.routeKey}`] || 0) + 1;
      if (s.kind === "task") edgeCount[`${s.nodeId}->${s.to}::next`] = (edgeCount[`${s.nodeId}->${s.to}::next`] || 0) + 1;
      prev = s.nodeId;
    }
  }
  const N = runs.length;
  cy.batch(() => {
    cy.edges().forEach((e) => {
      const c = edgeCount[e.id()] || 0;
      e.data("tw", c ? 1.5 + 9 * (c / N) : 1); e.data("to", c ? 0.45 + 0.55 * (c / N) : 0.15);
      if (c) e.data("label", `${e.data("base") ? e.data("base") + " · " : ""}${c}`);
      e.addClass("traffic");
    });
    cy.nodes().forEach((n) => { const c = nodeCount[n.id()] || (n.id() === "__trigger" ? N : 0); if (!c) n.addClass("dim"); else if (n.data("base") !== undefined) n.data("label", `${n.data("base")}\n${c} of ${N} runs`); });
  });
}

// ---- decision graph for one run -----------------------------------------------------------

export function renderTree(container, wf, run) {
  const P = palette();
  const els = [];
  const nodeLabel = (id) => wf.nodes[id]?.label || id;
  els.push({ data: { id: "in", label: trunc(`${run.input.subject ? run.input.subject + ": " : ""}${run.input.text}`, 90), tip: run.input.text }, classes: "input" });
  let prev = "in";
  run.steps.forEach((s, i) => {
    const sid = `s${i}`;
    if (s.kind === "decision") {
      const q = s.question;
      els.push({ data: { id: sid, label: `${trunc(s.label, 40)}\nconfidence ${s.confidence.toFixed(2)}`, tip: `${q.instructions}\nconfidence ${s.confidence.toFixed(3)}, threshold ${s.threshold.toFixed(2)}` }, classes: "decision" + (s.lowConfidence ? " low" : "") });
      els.push({ data: { id: `${prev}->${sid}`, source: prev, target: sid, label: "" }, classes: "path" });
      const node = wf.nodes[s.nodeId];
      for (const k of optionKeys(q)) {
        const p = s.probs[k] ?? 0, oid = `${sid}:${k}`;
        const rk = routeKeyForOption(node, k);
        const dest = rk !== undefined ? node.routes[rk] : null;
        const chosen = k === s.selected;
        els.push({ data: { id: oid, label: `${trunc(optionLabel(q, k), 26)}  ${pct(p)}${dest ? `\n→ ${trunc(nodeLabel(dest), 28)}` : ""}`, size: 26 + 70 * p, tip: `${optionLabel(q, k)}: p = ${p.toFixed(3)}${dest ? `\nroutes to: ${nodeLabel(dest)}` : ""}` }, classes: "option" + (chosen ? " chosen" : "") });
        els.push({ data: { id: `${sid}->${oid}`, source: sid, target: oid, label: "", w: 1 + 7 * p }, classes: "opt" + (chosen ? " chosen" : "") });
      }
      prev = `${sid}:${s.selected}`;
      if (s.escalated) {
        els.push({ data: { id: `${sid}:low`, label: `low confidence\n${s.confidence.toFixed(2)} < ${s.threshold.toFixed(2)}` }, classes: "lowbox" });
        els.push({ data: { id: `${sid}->${sid}:low`, source: sid, target: `${sid}:low`, label: "" }, classes: "path low" });
        prev = `${sid}:low`;
      }
    } else {
      const cls = s.kind === "task" ? "task" : `outcome ${s.disposition}`;
      const label = s.kind === "task" ? s.effect.text : s.label;
      els.push({ data: { id: sid, label: trunc(label, 70), tip: label }, classes: cls });
      els.push({ data: { id: `${prev}->${sid}`, source: prev, target: sid, label: "" }, classes: "path" });
      prev = sid;
    }
  });
  const style = [
    ...baseStyle(P),
    { selector: ".input", style: { shape: "round-rectangle", width: 190, height: 58, "background-color": P.accentSoft, "border-color": P.accent, "border-width": 2, "text-max-width": 176, "font-size": 10.5 } },
    { selector: ".decision", style: { shape: "diamond", width: 160, height: 100, "background-color": P.decisionSoft, "border-color": P.decision, "border-width": 2.5, "text-max-width": 100, "font-size": 10.5 } },
    { selector: ".decision.low", style: { "border-color": P.human } },
    { selector: ".option", style: { shape: "ellipse", width: "data(size)", height: "data(size)", "background-color": P.soft, "border-color": P.ink3, "text-valign": "bottom", "text-margin-y": 4, "text-max-width": 170, "font-size": 10, color: P.ink2 } },
    { selector: ".option.chosen", style: { "background-color": P.decision, "border-color": P.decision, color: P.ink, "font-weight": 700 } },
    { selector: "edge.opt", style: { width: "data(w)", "line-color": P.line, "target-arrow-shape": "none" } },
    { selector: "edge.opt.chosen", style: { "line-color": P.decision } },
    { selector: "edge.path", style: { width: 3, "line-color": P.accent, "target-arrow-color": P.accent } },
    { selector: "edge.path.low", style: { "line-style": "dashed", "line-color": P.human, "target-arrow-color": P.human } },
    { selector: ".lowbox", style: { shape: "round-rectangle", width: 130, height: 38, "background-color": P.humanSoft, "border-color": P.human, "font-size": 10 } },
    { selector: ".task", style: { shape: "round-rectangle", width: 190, height: 50, "background-color": P.taskSoft, "border-color": P.task, "text-max-width": 176, "font-size": 10.5 } },
    { selector: ".outcome", style: { shape: "round-rectangle", width: 160, height: 42, "border-width": 2.5, "font-weight": 700 } },
    { selector: ".outcome.auto", style: { "background-color": P.autoSoft, "border-color": P.auto } },
    { selector: ".outcome.human", style: { "background-color": P.humanSoft, "border-color": P.human } },
    { selector: ".outcome.block", style: { "background-color": P.blockSoft, "border-color": P.block } },
  ];
  const cy = cytoscape({ container, elements: els, style, wheelSensitivity: 0.25, minZoom: 0.15, maxZoom: 2.5, boxSelectionEnabled: false });
  runLayout(cy, { name: "dagre", rankDir: "LR", nodeSep: 14, rankSep: 60 });
  tip(cy);
  return cy;
}

// ---- ontology -------------------------------------------------------------------------------

const TYPE_COLOR = (P) => ({
  Workflow: [P.accentSoft, P.accent], DecisionNode: [P.decisionSoft, P.decision], TaskNode: [P.taskSoft, P.task],
  AutomatedOutcome: [P.autoSoft, P.auto], HumanReviewOutcome: [P.humanSoft, P.human], BlockedOutcome: [P.blockSoft, P.block],
  ChoiceQuestion: [P.klassSoft, P.klass], ScoreQuestion: [P.klassSoft, P.klass], YesNoQuestion: [P.klassSoft, P.klass],
  Option: [P.soft, P.ink3], Run: [P.run, P.run], Decision: [P.decision, P.decision], Effect: [P.taskSoft, P.task],
});
const SHAPE = { Workflow: "round-rectangle", DecisionNode: "diamond", TaskNode: "round-rectangle", AutomatedOutcome: "round-rectangle", HumanReviewOutcome: "round-rectangle",
  BlockedOutcome: "round-rectangle", ChoiceQuestion: "hexagon", ScoreQuestion: "hexagon", YesNoQuestion: "hexagon", Option: "ellipse", Run: "ellipse", Decision: "diamond", Effect: "rectangle" };

/** Pick the subgraph for a view. Returns { nodes: [{id, label, kind, type}], edges: [{s, p, o}] }. */
export function ontologySubgraph(onto, { view, workflowId, all, types }) {
  const nodes = new Map(), edges = [];
  const classIds = new Set(onto.classes.map((c) => c.id));
  const addClass = (id) => { if (!nodes.has("C:" + id)) nodes.set("C:" + id, { id: "C:" + id, label: id, kind: "class", type: id }); };
  const addInd = (i) => { if (!nodes.has(i.id)) nodes.set(i.id, { id: i.id, label: i.data.label || i.id, kind: "ind", type: i.types[0] }); };
  const inScope = (i) => all || i.workflowId === workflowId;

  if (view === "schema") {
    for (const c of onto.classes) { addClass(c.id); if (c.parent) edges.push({ s: "C:" + c.id, p: "subClassOf", o: "C:" + c.parent }); }
    for (const p of onto.objectProps) edges.push({ s: "C:" + p.domain, p: p.id, o: "C:" + p.range, prop: true });
    return { nodes: [...nodes.values()], edges };
  }
  const isRunPart = (i) => i.runId != null;
  const picked = [...onto.individuals.values()].filter((i) => inScope(i) && (view === "workflow" ? !isRunPart(i) : isRunPart(i)));
  picked.forEach(addInd);
  const keep = new Set(picked.map((i) => i.id));
  for (const l of onto.links) {
    if (!keep.has(l.s)) continue;
    if (view === "decisions" && !keep.has(l.o)) {
      // pull in the schema-level individual a run points at (the option selected, the node reached), not the whole workflow
      if (!["selected", "endedAt", "atNode"].includes(l.p)) continue;
      const o = onto.individuals.get(l.o); if (!o) continue;
      if (l.p === "atNode") continue; // the decision's label already names its node; keeps the graph readable
      addInd(o);
    }
    if (nodes.has(l.o)) edges.push({ s: l.s, p: l.p, o: l.o, weight: l.weight });
  }
  if (types) {
    for (const n of [...nodes.values()]) if (n.kind === "ind") {
      const i = onto.individuals.get(n.id);
      for (const t of i.types) if (classIds.has(t)) { addClass(t); edges.push({ s: n.id, p: "type", o: "C:" + t, isType: true }); }
    }
    for (const c of onto.classes) if (nodes.has("C:" + c.id) && c.parent) { addClass(c.parent); edges.push({ s: "C:" + c.id, p: "subClassOf", o: "C:" + c.parent }); }
  }
  return { nodes: [...nodes.values()], edges };
}

export function renderOntology(container, onto, opts, onSelect) {
  const P = palette();
  const { nodes, edges } = ontologySubgraph(onto, opts);
  const colors = TYPE_COLOR(P);
  const els = [];
  for (const n of nodes) {
    if (n.kind === "class") els.push({ data: { id: n.id, label: n.label, tip: `owl:Class lw:${n.label}` }, classes: "klass" });
    else {
      const [bg, bd] = colors[n.type] || [P.soft, P.case];
      els.push({ data: { id: n.id, label: trunc(n.label, 34), bg, bd, shape: SHAPE[n.type] || "round-rectangle", tip: `lw:${n.id}\na lw:${n.type}\n${n.label}` }, classes: "ind" + (n.type === "Run" || n.type === "Decision" ? " solid" : "") });
    }
  }
  edges.forEach((e, i) => els.push({ data: { id: `e${i}`, source: e.s, target: e.o, label: e.isType ? "" : e.p, w: e.weight != null ? 1 + 4 * e.weight : 1.4 }, classes: e.isType ? "type" : e.p === "subClassOf" ? "sub" : e.prop ? "prop" : "rel" }));
  const style = [
    ...baseStyle(P),
    { selector: ".klass", style: { shape: "round-rectangle", width: "label", height: 26, padding: 8, "background-color": P.klassSoft, "border-color": P.klass, "border-width": 2, color: P.klass, "font-weight": 700, "font-size": 11 } },
    { selector: ".ind", style: { shape: "data(shape)", width: 30, height: 30, "background-color": "data(bg)", "border-color": "data(bd)", "border-width": 2, "text-valign": "bottom", "text-margin-y": 3, "font-size": 9.5, "text-max-width": 120, color: P.ink2 } },
    { selector: ".ind.solid", style: { color: P.ink } },
    { selector: "edge", style: { "font-size": 9, width: "data(w)" } },
    { selector: "edge.sub", style: { "target-arrow-shape": "triangle", "target-arrow-fill": "hollow", "line-color": P.klass, "target-arrow-color": P.klass, color: P.klass } },
    { selector: "edge.prop", style: { "line-style": "dashed", "line-color": P.klass, "target-arrow-color": P.klass, "curve-style": "bezier", "control-point-step-size": 30 } },
    { selector: "edge.type", style: { "line-style": "dotted", "line-color": P.klass, "target-arrow-color": P.klass, opacity: 0.5 } },
    { selector: "node:selected", style: { "underlay-color": P.accent, "underlay-opacity": 0.25, "underlay-padding": 8 } },
    { selector: ".faded", style: { opacity: 0.15 } },
  ];
  const cy = cytoscape({ container, elements: els, style, wheelSensitivity: 0.25, minZoom: 0.08, maxZoom: 3, boxSelectionEnabled: false });
  const layout = opts.view === "schema"
    ? { name: "dagre", rankDir: "BT", nodeSep: 18, rankSep: 60, padding: 16 }
    : { name: "cose", animate: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 70, edgeElasticity: () => 80, gravity: 0.35, numIter: 1500, padding: 16, randomize: true };
  runLayout(cy, layout);
  tip(cy);
  cy.on("tap", "node", (e) => {
    const n = e.target;
    cy.elements().addClass("faded"); n.closedNeighborhood().removeClass("faded");
    onSelect?.(n.id().startsWith("C:") ? n.id().slice(2) : n.id());
  });
  cy.on("tap", (e) => { if (e.target === cy) { cy.elements().removeClass("faded"); onSelect?.(null); } });
  return cy;
}

/** Run a layout and fit the viewport once it has settled (dagre can finish after run() returns). */
function runLayout(cy, opts) {
  const fit = () => { cy.resize(); cy.fit(undefined, 16); };
  cy.one("layoutstop", () => requestAnimationFrame(fit));
  cy.layout({ padding: 16, fit: true, ...opts }).run();
}
