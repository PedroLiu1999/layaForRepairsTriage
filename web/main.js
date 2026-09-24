// Page wiring: model loading, running workflows, and the five views (diagram, decision graph, ontology,
// analytics, editor). Workflow logic lives in engine.js, graph drawing in graphs.js, the ontology in ontology.js.
import { runWorkflow, replayAt, validateWorkflow, decisionNodes, buildState, questionKey, DISPOSITIONS } from "./engine.js";
import { WORKFLOWS } from "./workflows.js";
import { renderDiagram, overlayRun, overlayTraffic, clearOverlay, renderTree, renderOntology } from "./graphs.js";
import { buildOntology, toTurtle, toJsonLd, describe } from "./ontology.js";
import { kpis, sweepChart, confChart, mixChart } from "./charts.js";
import { checkSafety } from "./safety.js";
import { preCheck, postCheck } from "./intake.js";
import { deriveTrack, computeDeadlines, getDeadlineStatus, alternativeAccommodationPrompt, checkPhaseScope, toLondonDateString } from "./compliance.js";
import { RULES, PHASES, DAY_COUNTING_CONVENTION } from "./rules/awaab-england.js";
import { BANK_HOLIDAY_DATES } from "./bankholidays.js";
import { createCase, reduceCase, appendEvent, canCloseCase, loadCases, saveCases, clearCases } from "./cases.js";
import { generateAcknowledgementLetter, generateSummaryLetter, generateAlternativeAccommodationLetter, formatDateWords } from "./letters.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (p) => `${Math.round(p * 100)}%`;

// ---- persistence (per-browser conveniences; everything works without it) -------------------
const store = {
  get(k, d) { try { const v = localStorage.getItem("irt." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("irt." + k, JSON.stringify(v)); return true; } catch { return false; } },
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
  tab: store.get("tab", "cases"), cy: {}, dirty: { tree: true, ontology: true, analytics: true },
  selectedExample: null,
  cases: [],
  simulatedDate: null,
  goodPractice: true,
  selectedCaseId: null,
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

function showCaseCreated(c) {
  const n = $("caseCreatedNotice");
  if (!n) return;
  n.hidden = false;
  const link = $("caseCreatedLink");
  if (link) {
    link.textContent = `Case #${c.id} created (${c.track.toUpperCase()}) — Click to view details & compliance clock →`;
    link.onclick = (e) => {
      e.preventDefault();
      openCaseModal(c.id);
    };
  }
}

async function runOne() {
  if (S.busy) return;
  const w = wf(), input = currentInput();
  if (!input.text) { $("runHint").textContent = "Type something or pick an example first."; return; }
  setBusy(true);
  try {
    const receivedInput = $("receivedAt")?.value;
    const receivedAt = receivedInput ? new Date(receivedInput).toISOString() : new Date().toISOString();

    // 1. Deterministic intake pre-checks
    const pre = preCheck(input.text);

    if (!pre.proceed) {
      const forcedOutcomeNode = "triage_officer";
      const forcedRun = {
        id: `run-${Date.now().toString(36)}`,
        workflowId: w.id,
        at: new Date().toISOString(),
        source: "intake_guard",
        threshold: S.threshold,
        input,
        steps: [],
        effects: [],
        outcome: { nodeId: forcedOutcomeNode, disposition: "human", label: pre.forcedOutcome },
        totalMs: 5,
      };

      const track = deriveTrack(forcedRun, pre.flags);
      const caseObj = createCase({
        text: input.text,
        receivedAt,
        track,
        category: null,
        vulnerable: false,
        intake: pre.flags,
        run: forcedRun,
        actor: "system",
      });

      S.cases.unshift(caseObj);
      saveCases(S.cases);
      renderCasesTable();
      showCaseCreated(caseObj);
      commitRun(forcedRun);
      return;
    }

    // 2. Normal execution through model or recorded answers
    const run = await execute(w, input);

    // 3. Post-check tripwire
    const post = postCheck(run, pre.flags);
    if (post.escalate) {
      run.outcome = { nodeId: "urgent_review", disposition: "human", label: "Urgent human review (tripwire escalated)" };
      run.tripwireEscalated = true;
    }

    const categorySelected = run.steps?.find((s) => s.nodeId === "category")?.selected || null;
    const vulnerableSelected = run.steps?.find((s) => s.nodeId === "vulnerable")?.selected === "true" ||
                               run.steps?.some((s) => s.nodeId === "flag_vulnerable");

    const track = deriveTrack(run, { ...pre.flags, tripwireEscalated: post.escalate });

    const caseObj = createCase({
      text: input.text,
      receivedAt,
      track,
      category: categorySelected,
      vulnerable: vulnerableSelected,
      intake: { ...pre.flags, tripwireEscalated: post.escalate },
      run,
      actor: run.source === "model" ? "model" : "system",
    });

    S.cases.unshift(caseObj);
    saveCases(S.cases);
    renderCasesTable();
    showCaseCreated(caseObj);

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

// ---- cases & compliance UI ------------------------------------------------------------------

function getSimulatedNow() {
  return S.simulatedDate ? new Date(S.simulatedDate) : new Date();
}

function formatCategoryName(cat) {
  const map = {
    damp_mould: "Damp & Mould",
    cold_heat: "Excess Cold / Heat",
    fire_electrical: "Fire & Electrical",
    falls_structural: "Falls & Structural",
    hygiene_pests: "Hygiene & Pests",
    general_repair: "General / Routine Repair",
  };
  return map[cat] || (cat ? String(cat).replace(/_/g, " ") : "Unspecified");
}

function getNextDeadlineInfo(caseObj, now, goodPractice = true) {
  const reduced = reduceCase(caseObj);
  if (reduced.status === "closed") {
    return { text: "Case Closed", status: "met", badgeClass: "met" };
  }
  const scopeInfo = checkPhaseScope(reduced.category, reduced.track, reduced.receivedAt, PHASES);
  if (!goodPractice && !scopeInfo.inScope) {
    return { text: "Out of statutory scope", status: "pending", badgeClass: "pending" };
  }
  if (reduced.track === "routine") {
    return { text: "Routine repair (standard timescales)", status: "met", badgeClass: "met" };
  }
  const deadlines = computeDeadlines(caseObj, RULES, BANK_HOLIDAY_DATES, DAY_COUNTING_CONVENTION);
  const activeDeadlines = deadlines.filter((d) => !d.metAt && d.dueAt);
  if (activeDeadlines.length === 0) {
    const pendingDeadlines = deadlines.filter((d) => !d.metAt && d.pending);
    if (pendingDeadlines.length > 0) {
      return { text: pendingDeadlines[0].pending, status: "pending", badgeClass: "pending" };
    }
    return { text: "All statutory deadlines met", status: "met", badgeClass: "met" };
  }
  activeDeadlines.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const nextDl = activeDeadlines[0];
  const st = getDeadlineStatus(nextDl, now);
  const nowMs = new Date(now).getTime();
  const dueMs = new Date(nextDl.dueAt).getTime();
  const diffHours = (dueMs - nowMs) / (3600 * 1000);
  let timeStr = "";
  if (st === "breached") {
    const overdueHours = Math.abs(diffHours);
    timeStr = overdueHours < 24 ? `OVERDUE by ${overdueHours.toFixed(1)}h` : `OVERDUE by ${(overdueHours / 24).toFixed(1)}d`;
  } else {
    timeStr = diffHours < 24 ? `${diffHours.toFixed(1)}h left` : `${(diffHours / 24).toFixed(1)}d left`;
  }
  return {
    deadline: nextDl,
    status: st,
    badgeClass: st,
    text: `${nextDl.description}: ${timeStr}`,
  };
}

function renderCasesTable() {
  const tbody = $("casesTableBody");
  if (!tbody) return;

  const now = getSimulatedNow();
  let emergencyCount = 0;
  let significantCount = 0;
  let dueSoonCount = 0;
  let breachedCount = 0;

  if (!S.cases || S.cases.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--ink2)">No cases recorded yet. Run a repair report or click an example on the left.</td></tr>`;
    $("kpiTotal").textContent = "0";
    $("kpiEmergency").textContent = "0";
    $("kpiSignificant").textContent = "0";
    $("kpiDueSoon").textContent = "0";
    $("kpiBreached").textContent = "0";
    return;
  }

  tbody.innerHTML = "";

  S.cases.forEach((rawCase) => {
    const c = reduceCase(rawCase);
    if (c.track === "emergency") emergencyCount++;
    if (c.track === "significant") significantCount++;

    const scope = checkPhaseScope(c.category, c.track, c.receivedAt, PHASES);
    const nextDl = getNextDeadlineInfo(rawCase, now, S.goodPractice);

    if (nextDl.status === "due_soon") dueSoonCount++;
    if (nextDl.status === "breached") breachedCount++;

    const tr = document.createElement("tr");

    const recD = new Date(c.receivedAt);
    const recStr = recD.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

    const trackBadge = `<span class="badge ${esc(c.track)}">${esc(c.track.toUpperCase())}</span>`;
    const vulnBadge = c.vulnerable ? `<span class="badge vulnerable">VULNERABLE</span>` : `<span style="color:var(--ink2)">No</span>`;
    const scopeBadge = scope.inScope
      ? `<span class="badge scope-in">${esc(scope.badgeText)}</span>`
      : `<span class="badge scope-out">${esc(scope.badgeText)}</span>`;
    const chipHtml = `<span class="chip ${esc(nextDl.badgeClass)}">${esc(nextDl.text)}</span>`;

    tr.innerHTML = `
      <td><strong>${esc(c.id)}</strong></td>
      <td style="font-size:12px">${esc(recStr)}</td>
      <td>${esc(formatCategoryName(c.category))}</td>
      <td>${trackBadge}</td>
      <td>${vulnBadge}</td>
      <td>${scopeBadge}</td>
      <td>${chipHtml}</td>
      <td style="font-size:11px;color:var(--ink2)">${esc(rawCase.actor || "model")}</td>
      <td><button type="button" class="ghost small view-case-btn" data-id="${esc(c.id)}">View / Manage</button></td>
    `;

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".view-case-btn").forEach((btn) => {
    btn.addEventListener("click", () => openCaseModal(btn.dataset.id));
  });

  $("kpiTotal").textContent = String(S.cases.length);
  $("kpiEmergency").textContent = String(emergencyCount);
  $("kpiSignificant").textContent = String(significantCount);
  $("kpiDueSoon").textContent = String(dueSoonCount);
  $("kpiBreached").textContent = String(breachedCount);
}

function openCaseModal(caseId) {
  S.selectedCaseId = caseId;
  const modal = $("caseDetailModal");
  if (!modal) return;
  renderCaseDetail(caseId);
  if (typeof modal.showModal === "function") {
    modal.showModal();
  } else {
    modal.hidden = false;
  }
}

function closeCaseModal() {
  const modal = $("caseDetailModal");
  if (!modal) return;
  if (typeof modal.close === "function") {
    modal.close();
  } else {
    modal.hidden = true;
  }
  S.selectedCaseId = null;
}

function renderCaseDetail(caseId) {
  const rawCase = S.cases.find((c) => c.id === caseId);
  const body = $("modalCaseBody");
  if (!rawCase || !body) return;

  const c = reduceCase(rawCase);
  const now = getSimulatedNow();
  const deadlines = computeDeadlines(rawCase, RULES, BANK_HOLIDAY_DATES, DAY_COUNTING_CONVENTION);
  const scope = checkPhaseScope(c.category, c.track, c.receivedAt, PHASES);
  const altPrompt = alternativeAccommodationPrompt(rawCase, now);

  $("modalCaseTitle").textContent = `${c.id} — ${formatCategoryName(c.category)} (${c.status.toUpperCase()})`;

  let altAlertHtml = "";
  if (altPrompt && !c.isSafe && c.track !== "routine") {
    altAlertHtml = `
      <div class="alt-accomm-alert">
        <span style="font-size:20px">⚠️</span>
        <div>
          <strong>Statutory Make-Safe Deadline Imminent or Breached:</strong>
          Under Awaab's Law regulations, when repairs cannot be made safe within statutory timescales, the landlord MUST offer suitable alternative accommodation at no expense to the tenant.
          <div style="margin-top:6px">
            <button type="button" id="modalAltOfferBtn" class="primary small">Offer Alternative Accommodation</button>
            <button type="button" id="modalAltLetterBtn" class="ghost small">Draft Accommodation Letter</button>
          </div>
        </div>
      </div>
    `;
  }

  const deadlineRows = deadlines.map((d) => {
    const st = getDeadlineStatus(d, now);
    const badgeClass = `chip ${st}`;
    const verifiedBadge = d.verified
      ? `<span class="badge verified">Verified (s.42)</span>`
      : `<span class="badge unverified" title="Provisional regulatory guidance; pending final ministerial order">Provisional / Unverified</span>`;

    const dueFormatted = d.dueAt
      ? new Date(d.dueAt).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : `<span style="color:var(--ink2)">${esc(d.pending || "Pending prerequisite")}</span>`;

    const metFormatted = d.metAt
      ? `<div style="font-size:11px;color:var(--task)">Met: ${new Date(d.metAt).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>`
      : "";

    return `
      <tr>
        <td><strong>${esc(d.description)}</strong><br><span style="font-size:11px;color:var(--ink2)">${esc(d.from)} (${esc(d.basis)})</span></td>
        <td>${dueFormatted}${metFormatted}</td>
        <td><span class="${badgeClass}">${st.replace(/_/g, " ").toUpperCase()}</span></td>
        <td>${verifiedBadge}<br><a href="${esc(d.source)}" target="_blank" rel="noopener" style="font-size:11px">Source legal text →</a></td>
      </tr>
    `;
  }).join("");

  const timelineItems = c.events.map((ev) => {
    const evTime = new Date(ev.at).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const evActor = `<span style="font-weight:600">${esc(ev.actor)}</span>`;
    let detail = "";
    if (ev.type === "received") detail = `Report received: "<em>${esc(ev.data?.text)}</em>"`;
    else if (ev.type === "triaged") detail = `Triage completed. Track: <strong>${esc(ev.data?.track)}</strong>, Category: <strong>${esc(formatCategoryName(ev.data?.category))}</strong>, Vulnerable: <strong>${ev.data?.vulnerable ? "Yes" : "No"}</strong>`;
    else if (ev.type === "tripwire_escalation") detail = `⚠️ Tripwire escalation: ${esc(ev.data?.reason)} (matched: ${esc((ev.data?.matches || []).join(", "))})`;
    else if (ev.type === "inspection_booked") detail = `Inspection booked for ${esc(ev.data?.bookedFor || "scheduled date")}`;
    else if (ev.type === "inspection_recorded") detail = `Inspection finding: <strong>${esc(ev.data?.finding)}</strong> by ${esc(ev.data?.competentPerson)}`;
    else if (ev.type === "summary_sent") detail = `Written summary of findings provided to tenant`;
    else if (ev.type === "made_safe") detail = `Hazard made safe: ${esc(ev.data?.note || "Temporary or permanent safety measures installed")}`;
    else if (ev.type === "works_started") detail = `Subsequent repair works commenced: ${esc(ev.data?.description || "Work in progress")}`;
    else if (ev.type === "contact_attempt") detail = `Contact attempt via ${esc(ev.data?.channel || "phone")}: ${esc(ev.data?.outcome || "logged")}`;
    else if (ev.type === "track_override") detail = `Track overridden from ${esc(ev.data?.from)} to <strong>${esc(ev.data?.track)}</strong>. Reason: ${esc(ev.data?.reason)}`;
    else if (ev.type === "category_override") detail = `Category overridden from ${esc(ev.data?.from)} to <strong>${esc(ev.data?.category)}</strong>. Reason: ${esc(ev.data?.reason)}`;
    else if (ev.type === "alt_accommodation_offered") detail = `Alternative accommodation offered to resident`;
    else if (ev.type === "alt_accommodation_declined") detail = `Alternative accommodation declined by resident`;
    else if (ev.type === "closed") detail = `Case closed by officer. Reason: ${esc(ev.data?.reason || "Resolved")}`;
    else detail = JSON.stringify(ev.data || {});

    return `
      <li class="timeline-item">
        <div class="timeline-meta">${esc(evTime)} · ${evActor} · <span class="badge ${esc(ev.type)}">${esc(ev.type)}</span></div>
        <div class="timeline-body">${detail}</div>
      </li>
    `;
  }).join("");

  body.innerHTML = `
    ${altAlertHtml}

    <div class="modal-section">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <div><strong>Status:</strong> <span class="badge ${c.status === "closed" ? "routine" : "emergency"}">${esc(c.status.toUpperCase())}</span></div>
        <div><strong>Track:</strong> <span class="badge ${esc(c.track)}">${esc(c.track.toUpperCase())}</span></div>
        <div><strong>Phase Scope:</strong> ${scope.inScope ? `<span class="badge scope-in">${esc(scope.badgeText)}</span>` : `<span class="badge scope-out">${esc(scope.badgeText)}</span>`}</div>
        <div><strong>Vulnerable Household:</strong> ${c.vulnerable ? `<span class="badge vulnerable">YES (Health / Age Cues)</span>` : `No`}</div>
      </div>
      <div><strong>Original Tenant Report:</strong></div>
      <blockquote style="margin:6px 0;padding:10px 14px;background:var(--soft);border-left:3px solid var(--accent);border-radius:4px;font-style:italic">
        ${esc(c.text)}
      </blockquote>
      ${c.intake?.languageGuard ? `<div class="badge manual" style="margin-top:4px">🌐 Non-English language detected: ${esc(c.intake.detectedScript || c.intake.detectedLanguage || "Foreign language")}</div>` : ""}
      ${c.intake?.tripwireEscalated ? `<div class="badge emergency" style="margin-top:4px">⚠️ Escalated by deterministic keyword tripwire</div>` : ""}
    </div>

    <div class="modal-section">
      <h3>Statutory Deadlines (Awaab's Law)</h3>
      <table class="cases-table" style="margin-top:8px">
        <thead>
          <tr>
            <th>Statutory Requirement</th>
            <th>Due Date &amp; Time (Europe/London)</th>
            <th>Compliance Status</th>
            <th>Legal Basis &amp; Verification</th>
          </tr>
        </thead>
        <tbody>
          ${deadlineRows || `<tr><td colspan="4">No statutory deadlines computed for this case.</td></tr>`}
        </tbody>
      </table>
    </div>

    <div class="modal-section">
      <h3>Tenant Communications (Plain English Drafts)</h3>
      <div class="btn-group">
        <button type="button" id="modalGenAckBtn" class="ghost small">Generate Acknowledgement Letter</button>
        <button type="button" id="modalGenSumBtn" class="ghost small">Generate Inspection Summary Letter</button>
        <button type="button" id="modalGenAltBtn" class="ghost small">Generate Alternative Accommodation Letter</button>
      </div>
      <div id="modalLetterContainer" style="margin-top:10px" hidden>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <strong id="modalLetterTitle">Draft Letter</strong>
          <button type="button" id="modalCopyLetterBtn" class="ghost small">Copy to Clipboard</button>
        </div>
        <pre id="modalLetterContent" class="letter-box"></pre>
      </div>
    </div>

    <div class="modal-section">
      <h3>Officer Action Drawer (Human Decisions &amp; Interventions)</h3>
      <p class="hint" style="margin-bottom:10px">The model classifies or escalates. Only a human housing officer or competent person can record inspections, overrides, safety status, or close cases.</p>
      
      <div class="action-grid">
        <div class="action-form">
          <label>Record Inspection</label>
          <div class="field" style="margin-top:6px">
            <input type="text" id="actInspector" placeholder="Competent person name" value="Duty Surveyor (HHSRS Qualified)" style="width:100%;font-size:12px">
          </div>
          <div class="field">
            <select id="actFinding" style="width:100%;font-size:12px">
              <option value="significant">Finding: Significant Hazard (Awaab In Scope)</option>
              <option value="emergency">Finding: Emergency Hazard (Immediate danger)</option>
              <option value="not_significant">Finding: Hazard Not Significant / Low Risk</option>
              <option value="no_access">Finding: No Access / Failed Attempt</option>
            </select>
          </div>
          <button type="button" id="actRecordInspBtn" class="primary small" style="width:100%">Record Inspection Finding</button>
        </div>

        <div class="action-form">
          <label>Log Contact Attempt</label>
          <div class="field" style="margin-top:6px">
            <select id="actContactChannel" style="width:100%;font-size:12px">
              <option value="phone">Phone call</option>
              <option value="sms">SMS / Text</option>
              <option value="email">Email</option>
              <option value="in_person">In-person visit</option>
            </select>
          </div>
          <div class="field">
            <select id="actContactOutcome" style="width:100%;font-size:12px">
              <option value="answered">Answered / Agreed access</option>
              <option value="voicemail">Left voicemail message</option>
              <option value="no_answer">No answer</option>
              <option value="access_refused">Tenant refused access</option>
            </select>
          </div>
          <button type="button" id="actLogContactBtn" class="ghost small" style="width:100%">Log Contact Attempt</button>
        </div>

        <div class="action-form">
          <label>Safety &amp; Works Milestones</label>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
            <button type="button" id="actMadeSafeBtn" class="small ${c.isSafe ? "ghost" : "primary"}" ${c.isSafe ? "disabled" : ""}>
              ${c.isSafe ? "✓ Marked Made Safe" : "Mark Hazard Made Safe"}
            </button>
            <button type="button" id="actWorksStartedBtn" class="small ${c.worksStarted ? "ghost" : "primary"}" ${c.worksStarted ? "disabled" : ""}>
              ${c.worksStarted ? "✓ Repair Works Started" : "Record Works Started"}
            </button>
            <button type="button" id="actSummarySentBtn" class="small ${c.summarySent ? "ghost" : "primary"}" ${c.summarySent ? "disabled" : ""}>
              ${c.summarySent ? "✓ Written Summary Sent" : "Mark Written Summary Sent"}
            </button>
          </div>
        </div>

        <div class="action-form">
          <label>Officer Override &amp; Closure</label>
          <div class="field" style="margin-top:6px">
            <select id="actOverrideTrack" style="width:100%;font-size:12px">
              <option value="emergency">Override to Emergency</option>
              <option value="significant">Override to Significant</option>
              <option value="routine">Override to Routine</option>
              <option value="manual">Override to Manual Review</option>
            </select>
          </div>
          <div class="field">
            <input type="text" id="actOverrideReason" placeholder="Reason for override..." style="width:100%;font-size:12px">
          </div>
          <button type="button" id="actApplyOverrideBtn" class="ghost small" style="width:100%;margin-bottom:6px">Apply Override</button>
          <button type="button" id="actCloseCaseBtn" class="danger small" style="width:100%" ${c.status === "closed" ? "disabled" : ""}>
            ${c.status === "closed" ? "Case is Closed" : "Close Case"}
          </button>
        </div>
      </div>
    </div>

    <div class="modal-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3>Append-Only Event Ledger (${c.events.length} events)</h3>
        <button type="button" id="modalExportAuditBtn" class="ghost small">Export JSON-LD Audit Pack</button>
      </div>
      <ul class="timeline">
        ${timelineItems}
      </ul>
    </div>
  `;

  function showLetter(title, content) {
    $("modalLetterTitle").textContent = title;
    $("modalLetterContent").textContent = content;
    $("modalLetterContainer").hidden = false;
  }

  $("modalAltOfferBtn")?.addEventListener("click", () => {
    appendEvent(rawCase, { actor: "officer:housing_manager", type: "alt_accommodation_offered", data: { offeredAt: now.toISOString() } });
    saveCases(S.cases);
    renderCasesTable();
    renderCaseDetail(caseId);
  });

  $("modalAltLetterBtn")?.addEventListener("click", () => {
    showLetter("Alternative Accommodation Offer Letter", generateAlternativeAccommodationLetter(c));
  });

  $("modalGenAckBtn")?.addEventListener("click", () => {
    showLetter("Tenant Acknowledgement Letter", generateAcknowledgementLetter(c));
  });

  $("modalGenSumBtn")?.addEventListener("click", () => {
    showLetter("Written Summary of Investigation Findings", generateSummaryLetter(c, c.inspectionFinding ? { finding: c.inspectionFinding, date: c.inspectionDate, inspector: c.competentPerson } : null, deadlines));
  });

  $("modalGenAltBtn")?.addEventListener("click", () => {
    showLetter("Alternative Accommodation Offer Letter", generateAlternativeAccommodationLetter(c));
  });

  $("modalCopyLetterBtn")?.addEventListener("click", () => {
    const text = $("modalLetterContent").textContent;
    navigator.clipboard?.writeText(text).then(() => alert("Letter copied to clipboard!"))
      .catch(() => alert("Failed to copy automatically; please copy the text manually."));
  });

  $("actRecordInspBtn")?.addEventListener("click", () => {
    const inspector = $("actInspector").value.trim() || "Competent person";
    const finding = $("actFinding").value;
    appendEvent(rawCase, {
      actor: `officer:${inspector.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      type: "inspection_recorded",
      at: now.toISOString(),
      data: { date: now.toISOString(), competentPerson: inspector, finding },
    });
    saveCases(S.cases);
    renderCasesTable();
    renderCaseDetail(caseId);
  });

  $("actLogContactBtn")?.addEventListener("click", () => {
    const channel = $("actContactChannel").value;
    const outcome = $("actContactOutcome").value;
    appendEvent(rawCase, {
      actor: "officer:triage_officer",
      type: "contact_attempt",
      at: now.toISOString(),
      data: { channel, outcome },
    });
    saveCases(S.cases);
    renderCasesTable();
    renderCaseDetail(caseId);
  });

  $("actMadeSafeBtn")?.addEventListener("click", () => {
    appendEvent(rawCase, {
      actor: "officer:safety_engineer",
      type: "made_safe",
      at: now.toISOString(),
      data: { note: "Hazard made safe by attending officer" },
    });
    saveCases(S.cases);
    renderCasesTable();
    renderCaseDetail(caseId);
  });

  $("actWorksStartedBtn")?.addEventListener("click", () => {
    appendEvent(rawCase, {
      actor: "officer:works_coordinator",
      type: "works_started",
      at: now.toISOString(),
      data: { description: "Contractor appointed and works initiated" },
    });
    saveCases(S.cases);
    renderCasesTable();
    renderCaseDetail(caseId);
  });

  $("actSummarySentBtn")?.addEventListener("click", () => {
    appendEvent(rawCase, {
      actor: "officer:triage_officer",
      type: "summary_sent",
      at: now.toISOString(),
      data: { method: "written_summary" },
    });
    saveCases(S.cases);
    renderCasesTable();
    renderCaseDetail(caseId);
  });

  $("actApplyOverrideBtn")?.addEventListener("click", () => {
    const targetTrack = $("actOverrideTrack").value;
    const reason = $("actOverrideReason").value.trim() || "Housing officer professional judgment";
    appendEvent(rawCase, {
      actor: "officer:senior_officer",
      type: "track_override",
      at: now.toISOString(),
      data: { from: c.track, track: targetTrack, reason },
    });
    saveCases(S.cases);
    renderCasesTable();
    renderCaseDetail(caseId);
  });

  $("actCloseCaseBtn")?.addEventListener("click", () => {
    const reason = prompt("Enter closure note / justification:") || "Repair completed and verified";
    try {
      appendEvent(rawCase, {
        actor: "officer:housing_manager",
        type: "closed",
        at: now.toISOString(),
        data: { reason },
      });
      saveCases(S.cases);
      renderCasesTable();
      renderCaseDetail(caseId);
    } catch (err) {
      alert(`Closure not permitted: ${err.message}`);
    }
  });

  $("modalExportAuditBtn")?.addEventListener("click", () => {
    exportCaseAuditPack(caseId);
  });
}

function exportCaseAuditPack(caseId) {
  const rawCase = S.cases.find((c) => c.id === caseId);
  if (!rawCase) return;
  const c = reduceCase(rawCase);
  const now = getSimulatedNow();
  const deadlines = computeDeadlines(rawCase, RULES, BANK_HOLIDAY_DATES, DAY_COUNTING_CONVENTION);

  const doc = {
    "@context": {
      "irt": "https://laya.rocks/repairs-triage#",
      "awaab": "https://www.legislation.gov.uk/ukpga/2023/36/section/42/enacted#",
      "xsd": "http://www.w3.org/2001/XMLSchema#",
    },
    "@type": "irt:CaseAuditPack",
    "irt:caseId": c.id,
    "irt:receivedAt": c.receivedAt,
    "irt:status": c.status,
    "irt:track": c.track,
    "irt:category": c.category,
    "irt:vulnerable": c.vulnerable,
    "irt:originalText": c.text,
    "irt:events": c.events,
    "irt:deadlines": deadlines.map((d) => ({
      "@type": "irt:Deadline",
      "irt:rule": d.ruleId,
      "irt:description": d.description,
      "irt:dueAt": d.dueAt,
      "irt:metAt": d.metAt,
      "irt:basis": d.basis,
      "irt:complianceStatus": getDeadlineStatus(d, now),
      "irt:legalSource": d.source,
      "irt:verified": d.verified,
    })),
  };

  download(`${c.id}-audit-pack.jsonld`, JSON.stringify(doc, null, 2), "application/ld+json");
}

function initSeedCases() {
  S.cases = loadCases();
  if (S.cases && S.cases.length > 0) return;

  const now = Date.now();
  const h = 3600 * 1000;
  const d = 24 * h;

  const seed1 = createCase({
    id: "IRT-DEMO-001",
    text: "Smell of gas in the hallway and the carbon monoxide alarm keeps beeping. Resident feels dizzy and nauseous.",
    receivedAt: new Date(now - 6 * h).toISOString(),
    track: "emergency",
    category: "fire_electrical",
    vulnerable: true,
    intake: { tripwireEscalated: true, tripwireMatches: ["smell of gas", "carbon monoxide", "co alarm"] },
    actor: "system",
  });

  const seed2 = createCase({
    id: "IRT-DEMO-002",
    text: "Severe black mould spreading across child's bedroom wall behind wardrobe. 4-year-old child has asthma and persistent night cough.",
    receivedAt: new Date(now - 3 * d).toISOString(),
    track: "significant",
    category: "damp_mould",
    vulnerable: true,
    intake: {},
    actor: "model",
  });
  appendEvent(seed2, {
    actor: "officer:allocator",
    type: "inspection_booked",
    at: new Date(now - 2 * d).toISOString(),
    data: { bookedFor: new Date(now + 2 * d).toISOString(), surveyor: "David Vance" },
  });

  const seed3 = createCase({
    id: "IRT-DEMO-003",
    text: "Water pouring through first-floor ceiling following storm damage to roof tiles. Ceiling plaster is sagging and water pooling on floor.",
    receivedAt: new Date(now - 8 * d).toISOString(),
    track: "significant",
    category: "falls_structural",
    vulnerable: false,
    intake: {},
    actor: "model",
  });
  appendEvent(seed3, {
    actor: "officer:sarah_jenkins",
    type: "inspection_recorded",
    at: new Date(now - 3 * d).toISOString(),
    data: {
      date: new Date(now - 3 * d).toISOString(),
      competentPerson: "Sarah Jenkins (Senior Structural Surveyor)",
      finding: "significant",
    },
  });
  appendEvent(seed3, {
    actor: "officer:sarah_jenkins",
    type: "summary_sent",
    at: new Date(now - 2 * d).toISOString(),
    data: { channel: "written_letter", address: "14 Elmhurst Road" },
  });

  const seed4 = createCase({
    id: "IRT-DEMO-004",
    text: "Cold water tap in kitchen drips slowly when shut tight. Sink drains normally and there is no leak beneath the cupboard.",
    receivedAt: new Date(now - 1 * d).toISOString(),
    track: "routine",
    category: "general_repair",
    vulnerable: false,
    intake: {},
    actor: "model",
  });

  const seed5 = createCase({
    id: "IRT-DEMO-005",
    text: "Dzień dobry, kaloryfer w salonie jest zupełnie zimny i cieknie z zaworu na podłogę. Proszę o pomoc.",
    receivedAt: new Date(now - 2 * h).toISOString(),
    track: "manual",
    category: null,
    vulnerable: false,
    intake: { languageGuard: true, forcedOutcome: "Needs translation / human triage" },
    actor: "system",
  });

  S.cases = [seed1, seed2, seed3, seed4, seed5];
  saveCases(S.cases);
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
  if (S.tab === "cases") {
    renderCasesTable();
  } else if (S.tab === "diagram") {
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
  const safetyViolations = checkSafety(obj);
  const allErrs = [...errs, ...safetyViolations.map((v) => `[Safety policy violation] ${v}`)];
  if (allErrs.length) { msg.className = "editormsg err"; msg.innerHTML = `${allErrs.length} problem${allErrs.length > 1 ? "s" : ""}:<ul>${allErrs.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`; return; }
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

  // Demo clock controls
  $("clockSlider")?.addEventListener("input", (e) => {
    const days = +e.target.value;
    if (days === 0) {
      S.simulatedDate = null;
      $("clockDisplay").textContent = "Current time (real)";
      $("clockPicker").value = "";
    } else {
      const sim = new Date(Date.now() + days * 24 * 3600 * 1000);
      S.simulatedDate = sim.toISOString();
      const localSim = new Date(sim.getTime() - sim.getTimezoneOffset() * 60000);
      $("clockPicker").value = localSim.toISOString().slice(0, 16);
      $("clockDisplay").textContent = `Simulated: ${formatDateWords(sim)} (+${days.toFixed(1)}d)`;
    }
    renderCasesTable();
    if (S.selectedCaseId) renderCaseDetail(S.selectedCaseId);
  });

  $("clockPicker")?.addEventListener("change", (e) => {
    const val = e.target.value;
    if (!val) {
      S.simulatedDate = null;
      $("clockSlider").value = 0;
      $("clockDisplay").textContent = "Current time (real)";
    } else {
      const sim = new Date(val);
      S.simulatedDate = sim.toISOString();
      const diffDays = Math.max(0, (sim.getTime() - Date.now()) / (24 * 3600 * 1000));
      $("clockSlider").value = Math.min(30, diffDays);
      $("clockDisplay").textContent = `Simulated: ${formatDateWords(sim)}`;
    }
    renderCasesTable();
    if (S.selectedCaseId) renderCaseDetail(S.selectedCaseId);
  });

  $("resetClockBtn")?.addEventListener("click", () => {
    S.simulatedDate = null;
    $("clockSlider").value = 0;
    $("clockPicker").value = "";
    $("clockDisplay").textContent = "Current time (real)";
    renderCasesTable();
    if (S.selectedCaseId) renderCaseDetail(S.selectedCaseId);
  });

  $("goodPracticeToggle")?.addEventListener("change", (e) => {
    S.goodPractice = e.target.checked;
    renderCasesTable();
    if (S.selectedCaseId) renderCaseDetail(S.selectedCaseId);
  });

  $("clearCasesBtn")?.addEventListener("click", () => {
    if (!confirm("Are you sure you want to clear all stored cases?")) return;
    clearCases();
    S.cases = [];
    renderCasesTable();
    if (S.selectedCaseId) closeCaseModal();
  });

  $("closeModalBtn")?.addEventListener("click", closeCaseModal);
  $("caseDetailModal")?.addEventListener("click", (e) => {
    if (e.target === $("caseDetailModal")) closeCaseModal();
  });

  const recAt = $("receivedAt");
  if (recAt && !recAt.value) {
    const nowLocal = new Date();
    nowLocal.setMinutes(nowLocal.getMinutes() - nowLocal.getTimezoneOffset());
    recAt.value = nowLocal.toISOString().slice(0, 16);
  }

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
window.__irt = window.__lw;

initSeedCases();
wire();
fillWorkflowSelect();
showTab(["cases", "diagram", "tree", "ontology", "analytics", "editor"].includes(store.get("tab")) ? store.get("tab") : "cases");
selectWorkflow(wf().id);
loadRecorded().then(updateRunHint);
initModelCard();
