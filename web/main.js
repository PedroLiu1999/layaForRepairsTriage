// Page wiring: model loading, running workflows, and the five views (diagram, decision graph, ontology,
// analytics, editor). Workflow logic lives in engine.js, graph drawing in graphs.js, the ontology in ontology.js.
import { runWorkflow, replayAt, validateWorkflow, decisionNodes, buildState, questionKey, DISPOSITIONS } from "./engine.js";
import { WORKFLOWS } from "./workflows.js";
import { renderDiagram, overlayRun, overlayTraffic, clearOverlay, renderTree, renderOntology } from "./graphs.js";
import { buildOntology, toTurtle, toJsonLd, describe } from "./ontology.js";
import { kpis, sweepChart, confChart, mixChart } from "./charts.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (p) => `${Math.round(p * 100)}%`;

// ---- persistence (per-browser conveniences; everything works without it) -------------------
const store = {
  get(k, d) { try { const v = localStorage.getItem("lw." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("lw." + k, JSON.stringify(v)); return true; } catch { return false; } },
};
const MAX_RUNS = 200;

// ---- state ----------------------------------------------------------------------------------
const S = {
  custom: store.get("custom", {}),       // id -> workflow (overrides or new)
  runs: store.get("runs", []),
  wfId: new URLSearchParams(location.search).get("wf") || store.get("wf", WORKFLOWS[0].id),
  threshold: store.get("threshold", 0.5),
  laya: null, model: null, loading: false, busy: false,
  recorded: null,                           // recorded.json: answers from the same model for the built-in examples
  last: null,                               // run shown in the result card (may be a what-if re-route)
  tab: "diagram", cy: {}, dirty: { tree: true, ontology: true, analytics: true },
  selectedExample: null,
};
const allWorkflows = () => {
  const list = WORKFLOWS.map((w) => S.custom[w.id] || w);
  for (const [id, w] of Object.entries(S.custom)) if (!WORKFLOWS.some((b) => b.id === id)) list.push(w);
  return list;
};
const wf = () => allWorkflows().find((w) => w.id === S.wfId) || allWorkflows()[0];
const runsOf = (id) => S.runs.filter((r) => r.workflowId === id);
const saveRuns = () => { while (S.runs.length > MAX_RUNS) S.runs.shift(); if (!store.set("runs", S.runs)) { S.runs = S.runs.slice(-50); store.set("runs", S.runs); } };

// ---- model ----------------------------------------------------------------------------------
let modelMod = null;
const modelApi = () => (modelMod ||= import("./model.js"));

function setPill(kind, text) { const p = $("modelPill"); p.className = "modelpill " + kind; $("modelPillText").textContent = text; }
function setStatus(msg, warn = false) { const s = $("status"); s.textContent = msg; s.classList.toggle("warn", warn); }
function setProgress(f) { $("progress").hidden = f == null; if (f != null) $("progressBar").style.width = (f * 100).toFixed(1) + "%"; }

async function initModelCard() {
  const m = await modelApi();
  const base = m.modelBase();
  const link = $("modelLink"); link.href = base === m.DEFAULT_MODEL_BASE ? m.MODEL_PAGE : base; link.textContent = base === m.DEFAULT_MODEL_BASE ? "VishalMysore/layaForWebTrained" : base;
  $("footModel").href = link.href;
  try {
    S.manifest = await m.fetchManifest(base);
    const sel = $("variant"); sel.innerHTML = "";
    for (const [k, v] of Object.entries(S.manifest.variants)) {
      const cached = await m.cachedParts(base, v.data);
      const tag = cached === v.data.parts.length ? ", cached" : cached ? `, ${cached}/${v.data.parts.length} parts cached` : "";
      sel.add(new Option(`${k === "q8e8" ? "int8 (recommended)" : k === "q4e8" ? "int4 (smaller, WebGPU)" : v.label} · ${Math.round(v.data.size / 1048576)} MB${tag}`, k));
    }
    $("loadBtn").disabled = false;
  } catch (e) {
    setStatus(`Could not read the model manifest from ${base} (${e.message}). Recorded examples still work.`, true);
  }
}

async function loadModel() {
  if (S.loading) return;
  S.loading = true; $("loadBtn").disabled = true; $("badges").innerHTML = "";
  setPill("busy", "Loading model…");
  try {
    const m = await modelApi();
    const { laya, backend, info } = await m.loadLaya({
      base: m.modelBase(), manifest: S.manifest, variant: $("variant").value, backend: $("backend").value,
      onStatus: setStatus, onProgress: setProgress,
    });
    S.laya = laya; S.model = { backend, ...info };
    setStatus(`Ready. Download ${(info.downloadMs / 1000).toFixed(1)} s${info.fromCache ? ` (${info.fromCache}/${info.parts} parts from cache)` : ""}, session ${(info.initMs / 1000).toFixed(1)} s, warm-up ${info.warmMs.toFixed(0)} ms.`);
    const badge = (t, ok) => { const b = document.createElement("span"); b.className = "badge" + (ok ? " ok" : ""); b.textContent = t; $("badges").appendChild(b); };
    badge(backend === "webgpu" ? "WebGPU" : `WASM · ${info.threads} thread${info.threads > 1 ? "s" : ""}`, true);
    badge(info.model || info.source); badge(info.variant); badge(`context ${info.maxLen} / options ${info.headMaxLen} tokens`);
    setPill("ready", `Model ready · ${backend === "webgpu" ? "WebGPU" : "WASM"}`);
    $("loadBtn").textContent = "Reload model";
  } catch (e) {
    console.error(e);
    setStatus("Could not load the model: " + (e?.message || e), true);
    setPill(S.recorded ? "replay" : "", S.recorded ? "Recorded answers only" : "Model not loaded");
  } finally { S.loading = false; $("loadBtn").disabled = false; setProgress(null); updateRunHint(); }
}

async function loadRecorded() {
  try {
    const r = await fetch("./recorded.json");
    if (r.ok) S.recorded = await r.json();
  } catch { /* optional */ }
  if (!S.laya) setPill(S.recorded ? "replay" : "", S.recorded ? "Recorded answers · load model for your own text" : "Model not loaded");
}

function recordedFor(w, input) {
  const list = S.recorded?.workflows?.[w.id];
  if (!list) return null;
  const hit = list.find((x) => x.text === input.text && (x.subject || "") === (input.subject || ""));
  if (!hit) return null;
  // recorded answers are only valid if the questions are unchanged (an edited workflow must use the live model)
  const sameQ = decisionNodes(w).every(({ id, node }) => hit.questions?.[id] === questionKey(node.question));
  return sameQ ? hit.answers : null;
}

// ---- running --------------------------------------------------------------------------------

function currentInput() {
  const w = wf();
  return { text: $("message").value.trim(), ...(w.input?.subject ? { subject: $("subject").value.trim() } : {}) };
}

/** Answer every decision node of `w` for `input` in ONE batched forward pass. */
async function answerAll(w, input) {
  const state = buildState(w, input);
  const questions = Object.fromEntries(decisionNodes(w).map(({ id, node }) => [id, node.question]));
  const res = await S.laya.systemOne(state, questions);
  return { answers: res.answers, ms: res.latency_ms };
}

async function execute(w, input, { animate = true } = {}) {
  let source, all = null, ask;
  const rec = recordedFor(w, input);
  if (S.laya) {
    source = "model";
    if ($("eager").checked) {
      const r = await answerAll(w, input); all = r.answers;
      ask = async (_q, _s, id) => all[id];
    } else {
      ask = async (q, state, id) => (await S.laya.systemOne(state, { [id]: q })).answers[id];
    }
  } else if (rec) {
    source = "recorded"; all = rec; ask = async (_q, _s, id) => rec[id];
  } else {
    throw new Error("Your own text needs the model. Press “Load model” above (downloads once, then cached), or pick one of the examples.");
  }
  const acc = [];
  const cy = S.cy.diagram;
  const run = await runWorkflow(w, input, ask, {
    threshold: S.threshold, source,
    onStep: async (step) => {
      acc.push(step);
      if (animate && cy && S.tab === "diagram") { overlayRun(cy, { steps: acc }, acc.length); await sleep(step.kind === "outcome" ? 0 : 260); }
    },
  });
  if (all) run.allAnswers = all;
  return run;
}

async function runOne() {
  if (S.busy) return;
  const w = wf(), input = currentInput();
  if (!input.text) { $("runHint").textContent = "Type something or pick an example first."; return; }
  setBusy(true);
  try {
    const run = await execute(w, input);
    commitRun(run);
    postWebhook(run);
  } catch (e) {
    console.error(e); $("runHint").textContent = e.message || String(e);
  } finally { setBusy(false); }
}

async function runAll() {
  if (S.busy) return;
  const w = wf();
  setBusy(true);
  let done = 0, failed = 0;
  try {
    for (const [i, ex] of w.examples.entries()) {
      fillExample(i);
      $("runHint").textContent = `Running example ${i + 1} of ${w.examples.length}…`;
      try { const run = await execute(w, { text: ex.text, ...(w.input?.subject ? { subject: ex.subject || "" } : {}) }, { animate: true }); commitRun(run); done++; }
      catch (e) { failed++; $("runHint").textContent = e.message; if (!S.laya) break; }
    }
    if (done) $("runHint").textContent = `Ran ${done} example${done > 1 ? "s" : ""}${failed ? `, ${failed} failed` : ""}. See Analytics and Ontology for the aggregate.`;
  } finally { setBusy(false); }
}

function commitRun(run) {
  S.runs.push(run); saveRuns();
  S.last = run; S.shown = null;
  S.dirty = { tree: true, ontology: true, analytics: true };
  showResult(run);
  refreshActive();
}

function setBusy(b) {
  S.busy = b;
  $("runBtn").disabled = b; $("runAllBtn").disabled = b;
  $("runBtn").textContent = b ? "Running…" : "Run workflow";
}

async function postWebhook(run) {
  const url = store.get("webhook", "");
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(summary(run)) });
  } catch (e) { console.warn("webhook failed", e); }
}

function summary(run) {
  return {
    id: run.id, workflow: run.workflowId, at: run.at, source: run.source, threshold: run.threshold, input: run.input,
    outcome: run.outcome, decisions: run.steps.filter((s) => s.kind === "decision").map((s) => ({
      node: s.nodeId, question: s.question.instructions, selected: s.selected, label: s.selectedLabel,
      probabilities: s.probs, branchProbability: s.confidence, layaConfidence: s.layaConfidence, cutoff: s.cutoff, lowConfidence: s.lowConfidence, routedTo: s.to,
    })),
    effects: run.effects.map((e) => ({ node: e.nodeId, channel: e.channel, text: e.text })),
    model: run.source === "model" ? { name: S.model?.model, build: S.model?.variant, backend: S.model?.backend } : { name: S.recorded?.model, build: S.recorded?.variant, recorded: true },
    totalMs: Math.round(run.totalMs),
  };
}

// ---- result card ------------------------------------------------------------------------------

function showResult(run) {
  const w = wf();
  $("resultCard").hidden = false;
  const o = run.outcome, d = DISPOSITIONS[o.disposition];
  const why = run.steps.filter((s) => s.kind === "decision" && s.escalated).map((s) => `“${s.label}” branch p ${s.confidence.toFixed(2)} < ${s.threshold.toFixed(2)}`);
  const nDec = run.steps.filter((s) => s.kind === "decision").length;
  const src = run.source === "recorded" ? "recorded answers from the same model" : `${(run.totalMs / 1000).toFixed(1)} s on this device`;
  $("outcome").innerHTML = `<div class="outcome ${o.disposition}"><div class="k">${esc(d.label)}</div><div class="t">${esc(o.label)}</div>
    <div class="d">${why.length ? "Escalated: " + esc(why.join("; ")) + ". " : ""}${esc(o.detail || "")} ${nDec} decision${nDec === 1 ? "" : "s"} · ${esc(src)}${run.whatIf ? ` · re-routed at threshold ${run.threshold.toFixed(2)}` : ""}</div></div>`;
  $("trace").innerHTML = run.steps.map((s) => {
    if (s.kind === "decision") {
      const bars = Object.entries(s.probs).map(([k, p]) => {
        const lab = s.question.type === "score" ? `${k}: ${s.question.criteria[+k]}` : s.question.type === "noul" ? (k === "true" ? "yes" : "no") : k;
        return `<div class="bar${k === s.selected ? " sel" : ""}"><span class="n" title="${esc(lab)}">${esc(lab)}</span><span class="tr"><span class="f" style="width:${(p * 100).toFixed(1)}%"></span></span><span class="v">${pct(p)}</span></div>`;
      }).join("");
      const dest = w.nodes[s.to]?.label || s.to;
      return `<li class="decision"><div class="h">${esc(s.label)} → ${esc(s.selectedLabel)}</div>
        <div class="s">branch p ${s.confidence.toFixed(2)} ${s.lowConfidence ? `<span class="low">below ${s.threshold.toFixed(2)}${s.escalated ? ", escalated" : ", flagged"}</span>` : `≥ ${s.threshold.toFixed(2)}`}${s.cutoff != null ? ` · yes if p ≥ ${s.cutoff}` : ""} · Laya confidence ${(s.layaConfidence ?? 0).toFixed(2)} · next: ${esc(dest)}</div>
        <div class="bars">${bars}</div></li>`;
    }
    if (s.kind === "task") return `<li class="task"><div class="h">${esc(s.label)}</div><div class="s">${esc(s.effect.text)}</div></li>`;
    return `<li class="outcome ${s.disposition}"><div class="h">${esc(s.label)}</div></li>`;
  }).join("");
  $("effects").innerHTML = run.effects.length ? run.effects.map((e) => `<li><span class="ch">${esc(e.channel)}</span>${esc(e.text)}</li>`).join("") : "<li>None</li>";
  $("raw").textContent = JSON.stringify(summary(run), null, 2);
}

/** Threshold changed: re-route the displayed run with its recorded answers (no model call). */
async function whatIf() {
  const base = S.last;
  if (!base || base.workflowId !== wf().id) return;
  try {
    const run = await replayAt(wf(), base, S.threshold, base.allAnswers);
    run.whatIf = run.threshold !== base.threshold; run.allAnswers = base.allAnswers; run.source = base.source; run.totalMs = base.totalMs;
    S.shown = run;
    showResult(run);
    if (S.cy.diagram && !$("traffic").checked) overlayRun(S.cy.diagram, run);
    S.dirty.tree = true; S.dirty.analytics = true;
    if (S.tab === "tree" || S.tab === "analytics") refreshActive();
  } catch {
    $("runHint").textContent = "This run didn't record every decision, so it can't be re-routed at a new threshold. Run it again with batch answering on.";
  }
}

// ---- views ------------------------------------------------------------------------------------

function showTab(tab) {
  S.tab = tab;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  store.set("tab", tab);
  refreshActive(true);
}

function refreshActive(tabSwitch = false) {
  const w = wf();
  if (S.tab === "diagram") {
    const cy = S.cy.diagram;
    if (!cy) return drawDiagram();
    if (tabSwitch) { cy.resize(); cy.fit(undefined, 16); }
    applyDiagramOverlay();
  } else if (S.tab === "tree") {
    if (!S.dirty.tree && S.cy.tree && tabSwitch) { S.cy.tree.resize(); S.cy.tree.fit(undefined, 16); return; }
    const run = S.shown || S.last || [...runsOf(w.id)].pop();
    S.cy.tree?.destroy(); S.cy.tree = null;
    const box = $("cyTree"); box.innerHTML = "";
    if (!run || run.workflowId !== w.id) { box.innerHTML = `<div class="empty">Run the “${esc(w.name)}” workflow to see its decision graph.</div>`; }
    else { S.cy.tree = renderTree(box, w, run); $("treeCaption").textContent = `Run on “${(run.input.subject ? run.input.subject + ": " : "") + run.input.text.slice(0, 80)}${run.input.text.length > 80 ? "…" : ""}”. Every decision expanded into all its options: node size is the model's probability, the highlighted chain is the path taken.`; }
    S.dirty.tree = false;
  } else if (S.tab === "ontology") {
    if (!S.dirty.ontology && S.cy.onto && tabSwitch) { S.cy.onto.resize(); S.cy.onto.fit(undefined, 16); return; }
    drawOntology();
  } else if (S.tab === "analytics") {
    drawAnalytics();
  } else if (S.tab === "editor") {
    if (tabSwitch || !$("editor").value) loadEditor();
  }
}

function drawDiagram() {
  S.cy.diagram?.destroy();
  S.cy.diagram = renderDiagram($("cyDiagram"), wf(), { rankDir: $("rankDir").value });
  applyDiagramOverlay();
}
function applyDiagramOverlay() {
  const cy = S.cy.diagram, w = wf();
  if (!cy) return;
  if ($("traffic").checked) {
    const rs = runsOf(w.id);
    overlayTraffic(cy, rs);
    $("diagramCaption").textContent = rs.length ? `Traffic from ${rs.length} run${rs.length > 1 ? "s" : ""}: edge width is how often each branch was taken.` : "No runs yet for this workflow.";
    return;
  }
  const run = S.shown || S.last;
  if (run && run.workflowId === w.id) {
    overlayRun(cy, run);
    $("diagramCaption").textContent = "Lit path = the route this run took. Edge labels show how much of the model's probability went down each branch; a dashed amber edge is the low-confidence escape hatch.";
  } else {
    clearOverlay(cy);
    $("diagramCaption").textContent = "Each diamond is one typed question the model answers. Run the workflow to light up the path; edge labels then show how much probability went down each branch.";
  }
}

let onto = null;
function drawOntology() {
  onto = buildOntology(allWorkflows(), S.runs);
  S.cy.onto?.destroy();
  const box = $("cyOnto"); box.innerHTML = "";
  const view = $("ontoView").value;
  const opts = { view, workflowId: wf().id, all: $("ontoAll").checked, types: $("ontoTypes").checked };
  if (view === "decisions" && !S.runs.some((r) => opts.all || r.workflowId === opts.workflowId)) {
    box.innerHTML = `<div class="empty">No runs yet. Every run you make becomes a lw:Run individual here, with its decisions as graph nodes linked to the options they selected.</div>`;
    S.cy.onto = null;
  } else {
    S.cy.onto = renderOntology(box, onto, opts, inspect);
  }
  S.dirty.ontology = false;
  inspect(null);
}

function inspect(id) {
  const el = $("inspector");
  const counts = onto ? `${onto.classes.length} classes · ${onto.objectProps.length} object properties · ${onto.individuals.size} individuals · ${onto.links.length} links` : "";
  if (!id) { el.innerHTML = `<p class="hint">Click a node to see its triples.</p><p class="hint">${counts}</p>`; return; }
  const d = describe(onto, id);
  if (!d) { el.textContent = id; return; }
  const ref = (x, label) => `<a data-go="${esc(x)}">${esc(label)}</a>`;
  if (d.kind === "class") {
    el.innerHTML = `<h3>lw:${esc(d.id)}</h3><div class="types">owl:Class${d.parent ? ` ⊑ lw:${esc(d.parent)}` : ""}</div><p>${esc(d.comment)}</p>
      <table><tr><td>instances</td><td>${d.instances}</td></tr>${d.subclasses.length ? `<tr><td>subclasses</td><td>${d.subclasses.map(esc).join(", ")}</td></tr>` : ""}
      ${d.props.map((p) => `<tr><td>${esc(p.id)}</td><td>${esc(p.domain)} → ${esc(p.range)}</td></tr>`).join("")}</table>`;
  } else {
    const data = Object.entries(d.data).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `<tr><td>lw:${esc(k)}</td><td>${esc(typeof v === "number" ? +v.toFixed(4) : v)}</td></tr>`).join("");
    el.innerHTML = `<h3>${esc(d.data.label || d.id)}</h3><div class="types">lw:${esc(d.id)}<br>a ${d.types.map((t) => "lw:" + esc(t)).join(", ")}</div>
      <table>${data}${d.out.map((l) => `<tr><td>lw:${esc(l.p)}</td><td>${ref(l.id, l.label)}</td></tr>`).join("")}
      ${d.in.map((l) => `<tr><td>^lw:${esc(l.p)}</td><td>${ref(l.id, l.label)}</td></tr>`).join("")}</table>`;
  }
  el.querySelectorAll("a[data-go]").forEach((a) => a.addEventListener("click", () => {
    const n = S.cy.onto?.$id(a.dataset.go);
    if (n && n.length) { S.cy.onto.elements().unselect(); n.select(); n.emit("tap"); S.cy.onto.animate({ center: { eles: n }, duration: 250 }); }
    else inspect(a.dataset.go);
  }));
}

let sweepToken = 0;
async function drawAnalytics() {
  const w = wf(), rs = runsOf(w.id);
  kpis($("kpis"), rs);
  mixChart($("chartMix"), allWorkflows(), S.runs);
  confChart($("chartConf"), w, rs, S.threshold);
  // threshold sweep via replay (only runs that recorded every decision can be re-routed)
  const token = ++sweepToken;
  const replayable = rs.filter((r) => r.allAnswers);
  const series = [];
  for (let t = 0.3; t <= 0.951; t += 0.025) {
    const s = { t: +t.toFixed(3), auto: 0, human: 0, block: 0, n: 0 };
    for (const r of replayable) {
      try { const x = await replayAt(w, r, s.t, r.allAnswers); s[x.outcome.disposition]++; s.n++; } catch { /* skip */ }
    }
    series.push(s);
    if (token !== sweepToken) return;
  }
  sweepChart($("chartSweep"), series, S.threshold);
  S.dirty.analytics = false;
}

// ---- editor -----------------------------------------------------------------------------------

function loadEditor() {
  const w = wf();
  const { examples, ...rest } = w;
  $("editor").value = JSON.stringify({ ...rest, examples }, null, 2);
  $("editorMsg").className = "editormsg"; $("editorMsg").textContent = S.custom[w.id] ? "This workflow has local edits." : "";
  $("resetBtn").disabled = !(S.custom[w.id] && WORKFLOWS.some((b) => b.id === w.id));
}

function applyEditor() {
  const msg = $("editorMsg");
  let obj;
  try { obj = JSON.parse($("editor").value); } catch (e) { msg.className = "editormsg err"; msg.textContent = "Not valid JSON: " + e.message; return; }
  obj.examples ||= [];
  const errs = validateWorkflow(obj);
  if (errs.length) { msg.className = "editormsg err"; msg.innerHTML = `${errs.length} problem${errs.length > 1 ? "s" : ""}:<ul>${errs.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`; return; }
  const prevId = S.wfId;
  S.custom[obj.id] = obj; store.set("custom", S.custom);
  if (obj.id !== prevId && S.custom[prevId] && !WORKFLOWS.some((b) => b.id === prevId)) { delete S.custom[prevId]; store.set("custom", S.custom); }
  selectWorkflow(obj.id);
  msg.className = "editormsg ok"; msg.textContent = `Valid. Applied “${obj.name}” (${Object.keys(obj.nodes).length} nodes). Saved in this browser.`;
}

function newWorkflow() {
  let n = 1; while (allWorkflows().some((w) => w.id === `my-workflow-${n}`)) n++;
  const tpl = {
    id: `my-workflow-${n}`, name: `My workflow ${n}`, domain: "Custom", entity: "Request", description: "Describe what this workflow automates.", input: {},
    start: "is_urgent",
    nodes: {
      is_urgent: { type: "decision", label: "Urgent?", question: { type: "noul", instructions: "The request needs action today" }, routes: { true: "notify", false: "category" }, onLowConfidence: "review" },
      category: { type: "decision", label: "Category", question: { type: "choice", instructions: "What is this request about?", criteria: { question: "A question", complaint: "A complaint", other: "Something else" } }, routes: { question: "answer", complaint: "review", other: "review" } },
      notify: { type: "task", channel: "chat", label: "Notify the on-duty person", template: "Urgent: {{input.text}}", next: "review" },
      answer: { type: "task", channel: "email", label: "Send standard answer", template: "Auto-answer sent.", next: "done" },
      done: { type: "outcome", disposition: "auto", label: "Done automatically" },
      review: { type: "outcome", disposition: "human", label: "A person handles it" },
    },
    examples: [{ text: "Our office printer is on fire, please send someone now!" }, { text: "What are your opening hours on Saturday?" }],
  };
  $("editor").value = JSON.stringify(tpl, null, 2);
  $("editorMsg").className = "editormsg"; $("editorMsg").textContent = "A starter workflow. Edit it, then press Validate & apply.";
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- workflow picker & examples -----------------------------------------------------------------

function fillWorkflowSelect() {
  const sel = $("workflow"); sel.innerHTML = "";
  for (const w of allWorkflows()) sel.add(new Option(`${w.name}${S.custom[w.id] ? " (edited)" : ""}`, w.id));
  sel.value = wf().id;
}

function selectWorkflow(id) {
  S.wfId = id; store.set("wf", id);
  const w = wf();
  fillWorkflowSelect();
  $("wfDesc").textContent = `${w.domain ? w.domain + " · " : ""}${w.description || ""}`;
  $("subjectField").hidden = !w.input?.subject;
  $("examples").innerHTML = "";
  (w.examples || []).forEach((ex, i) => {
    const b = document.createElement("button"); b.type = "button";
    b.textContent = ex.subject || ex.text.slice(0, 38) + (ex.text.length > 38 ? "…" : "");
    b.title = ex.text; b.addEventListener("click", () => fillExample(i));
    $("examples").appendChild(b);
  });
  S.last = [...runsOf(w.id)].pop() || null; S.shown = null;
  if (S.last) showResult(S.last); else $("resultCard").hidden = true;
  if (S.last) {
    // show the input of the run that is on screen
    $("message").value = S.last.input.text; $("subject").value = S.last.input.subject || "";
    S.selectedExample = w.examples.findIndex((ex) => ex.text === S.last.input.text);
    [...$("examples").children].forEach((b, j) => b.classList.toggle("active", j === S.selectedExample));
    updateRunHint();
  } else if (!$("message").value || S.selectedExample != null) fillExample(0);
  S.dirty = { tree: true, ontology: true, analytics: true };
  S.cy.diagram?.destroy(); S.cy.diagram = null;
  const u = new URL(location.href); u.searchParams.set("wf", id); history.replaceState(null, "", u);
  if (S.tab === "diagram") drawDiagram(); else refreshActive(true);
  if (S.tab === "editor") loadEditor();
}

function fillExample(i) {
  const w = wf(), ex = w.examples?.[i];
  if (!ex) return;
  $("message").value = ex.text; $("subject").value = ex.subject || "";
  S.selectedExample = i;
  [...$("examples").children].forEach((b, j) => b.classList.toggle("active", j === i));
  updateRunHint();
}

function updateRunHint() {
  if (S.busy) return;
  const w = wf(), input = currentInput();
  const h = $("runHint");
  if (S.laya) h.textContent = "Runs on this device with the loaded model.";
  else if (!input.text) h.textContent = "";
  else if (recordedFor(w, input)) h.textContent = "Model not loaded: this example plays back answers recorded from the same model. Load the model to run your own text.";
  else h.textContent = "Your own text needs the model. Load it above (downloads once, then cached).";
}

// ---- wiring -------------------------------------------------------------------------------------

function wire() {
  $("loadBtn").addEventListener("click", loadModel);
  $("workflow").addEventListener("change", (e) => selectWorkflow(e.target.value));
  $("runBtn").addEventListener("click", runOne);
  $("runAllBtn").addEventListener("click", runAll);
  $("message").addEventListener("input", () => { S.selectedExample = null; [...$("examples").children].forEach((b) => b.classList.remove("active")); updateRunHint(); });
  $("subject").addEventListener("input", updateRunHint);
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && document.activeElement !== $("editor")) runOne(); });

  $("thresh").value = S.threshold; $("threshVal").textContent = (+S.threshold).toFixed(2);
  $("thresh").addEventListener("input", () => {
    S.threshold = +$("thresh").value; $("threshVal").textContent = S.threshold.toFixed(2); store.set("threshold", S.threshold);
    whatIf();
  });
  $("eager").checked = store.get("eager", true);
  $("eager").addEventListener("change", () => store.set("eager", $("eager").checked));

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("traffic").addEventListener("change", applyDiagramOverlay);
  $("rankDir").value = store.get("rankDir", "TB");
  $("rankDir").addEventListener("change", () => { store.set("rankDir", $("rankDir").value); drawDiagram(); });
  $("fitBtn").addEventListener("click", () => S.cy.diagram?.fit(undefined, 16));
  $("treeFit").addEventListener("click", () => S.cy.tree?.fit(undefined, 16));
  $("ontoFit").addEventListener("click", () => S.cy.onto?.fit(undefined, 16));
  for (const id of ["ontoView", "ontoTypes", "ontoAll"]) $(id).addEventListener("change", drawOntology);
  $("ttlBtn").addEventListener("click", () => download("laya-workflows.ttl", toTurtle(buildOntology(allWorkflows(), S.runs)), "text/turtle"));
  $("jsonldBtn").addEventListener("click", () => download("laya-workflows.jsonld", JSON.stringify(toJsonLd(buildOntology(allWorkflows(), S.runs)), null, 2), "application/ld+json"));
  $("clearBtn").addEventListener("click", () => {
    if (!confirm("Delete all stored runs in this browser?")) return;
    S.runs = []; saveRuns(); S.last = null; S.shown = null; $("resultCard").hidden = true;
    S.dirty = { tree: true, ontology: true, analytics: true }; refreshActive(); applyDiagramOverlay();
  });

  $("applyBtn").addEventListener("click", applyEditor);
  $("newBtn").addEventListener("click", newWorkflow);
  $("resetBtn").addEventListener("click", () => { delete S.custom[S.wfId]; store.set("custom", S.custom); selectWorkflow(S.wfId); loadEditor(); });
  $("exportWfBtn").addEventListener("click", () => { const w = wf(); download(`${w.id}.json`, JSON.stringify(w, null, 2), "application/json"); });
  $("importWf").addEventListener("change", async (e) => { const f = e.target.files?.[0]; if (!f) return; $("editor").value = await f.text(); e.target.value = ""; applyEditor(); });
  $("editor").addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); const t = e.target, s = t.selectionStart; t.setRangeText("  ", s, t.selectionEnd, "end"); }
  });
  $("webhook").value = store.get("webhook", "");
  $("webhook").addEventListener("change", () => store.set("webhook", $("webhook").value.trim()));

  // theme changes: redraw graphs so their colours follow
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { S.dirty = { tree: true, ontology: true, analytics: true }; drawDiagram(); refreshActive(); });
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => Object.values(S.cy).forEach((c) => c?.resize()), 150); });
}

// Hooks for automation/testing and for regenerating recorded.json (see README).
window.__lw = {
  get ready() { return !!S.laya; }, loadModel, runOne, runAll, state: S, WORKFLOWS,
  /** With the model loaded: answer every decision node for every example, in the recorded.json format. */
  async record() {
    if (!S.laya) throw new Error("load the model first");
    const out = { model: S.model.model, source: S.model.source, variant: S.model.variant, backend: S.model.backend, createdAt: new Date().toISOString(), workflows: {} };
    for (const w of WORKFLOWS) {
      out.workflows[w.id] = [];
      for (const ex of w.examples) {
        const input = { text: ex.text, ...(w.input?.subject ? { subject: ex.subject || "" } : {}) };
        const { answers } = await answerAll(w, input);
        for (const a of Object.values(answers)) delete a.legend; // the legend is the question's own criteria
        out.workflows[w.id].push({ ...input, answers, questions: Object.fromEntries(decisionNodes(w).map(({ id, node }) => [id, questionKey(node.question)])) });
      }
    }
    return out;
  },
};

wire();
fillWorkflowSelect();
showTab(["diagram", "tree", "ontology", "analytics", "editor"].includes(store.get("tab")) ? store.get("tab") : "diagram");
selectWorkflow(wf().id);
loadRecorded().then(updateRunHint);
initModelCard();
