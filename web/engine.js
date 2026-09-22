// Workflow engine: a workflow is a directed acyclic graph of three node kinds.
//
//   decision  asks Laya ONE typed question (choice | score | noul) and follows the route that matches the answer.
//             The gate is the BRANCH PROBABILITY: the share of the model's probability that went down the chosen
//             route. If it is below the node's threshold (`minConfidence`, else the global one), the run follows
//             `onLowConfidence` instead (usually a person). No `onLowConfidence` = take the branch anyway, but flag it.
//             Yes/no nodes may set `cutoff` (default 0.5): the p(true) needed to take the "true" branch. A low
//             cutoff makes a fail-closed gate, e.g. block when p(destructive) >= 0.3.
//   task      an automation step (send a message, open a ticket, call a webhook...). Runs, then goes to `next`.
//   outcome   a terminal node with a disposition: "auto" (fully automated), "human" (a person decides) or "block".
//
// Routes by question type:
//   choice  one key per criterion, e.g. { bug: "urgency", how_to: "send_docs" }
//   score   level ranges on the rounded expected score, e.g. { "0-1": "backlog", "2": "today", "3": "page" }
//   noul    { "true": ..., "false": ... }
//
// This file has no DOM or model dependencies; `ask(question, state, nodeId)` is injected so the same engine runs
// against the ONNX model in the browser, recorded answers, or a mock in the Node tests.

export const DISPOSITIONS = {
  auto: { label: "Automated", short: "auto" },
  human: { label: "Human review", short: "human" },
  block: { label: "Blocked", short: "block" },
};
export const MAX_STEPS = 32;
export const LOW = "__low__";

// ---- helpers ------------------------------------------------------------------------------

/** Parse a score route key: "2" -> [2,2], "0-1" -> [0,1], "2+" -> [2,Infinity]. */
export function parseRange(key) {
  const k = String(key).trim();
  let m;
  if ((m = k.match(/^(\d+)$/))) return [+m[1], +m[1]];
  if ((m = k.match(/^(\d+)\s*-\s*(\d+)$/))) return [+m[1], +m[2]];
  if ((m = k.match(/^(\d+)\+$/))) return [+m[1], Infinity];
  return null;
}

/** Option keys a question can produce, in model order. */
export function optionKeys(q) {
  if (q.type === "choice") return Array.isArray(q.criteria) ? q.criteria.slice() : Object.keys(q.criteria);
  if (q.type === "score") return q.criteria.map((_, i) => String(i));
  return ["false", "true"];
}

/** Human-readable option label. */
export function optionLabel(q, key) {
  if (q.type === "score") return `${key}: ${q.criteria[+key]}`;
  if (q.type === "noul") return key === "true" ? "yes" : "no";
  return key;
}

/** Map a single option key to its route key on a node (or undefined). */
export function routeKeyForOption(node, optKey) {
  const q = node.question, routes = node.routes || {};
  if (q.type === "score") {
    const lvl = +optKey;
    return Object.keys(routes).find((rk) => { const r = parseRange(rk); return r && lvl >= r[0] && lvl <= r[1]; });
  }
  return Object.prototype.hasOwnProperty.call(routes, optKey) ? optKey : undefined;
}

/** Probability of each option key, normalised from a Laya answer. */
export function optionProbs(q, answer) {
  if (q.type === "noul") return { false: round4(1 - answer.noul), true: round4(answer.noul) };
  return { ...answer.probabilities };
}

/** The option the answer selects: argmax for choice, rounded expected score for score, p >= cutoff for noul. */
export function selectedOption(q, answer, cutoff = 0.5) {
  if (q.type === "choice") return answer.choice;
  if (q.type === "score") return String(Math.min(q.criteria.length - 1, Math.max(0, Math.round(answer.score))));
  return answer.noul >= cutoff ? "true" : "false";
}

/** The option a node selects and the probability mass on the route it leads to (the gating value). */
export function branchOf(node, answer) {
  const selected = selectedOption(node.question, answer, node.cutoff ?? 0.5);
  const routeKey = routeKeyForOption(node, selected);
  const mass = routeMass(node, answer);
  return { selected, routeKey, p: mass[routeKey] ?? 0, mass };
}

/** Probability mass flowing down each route of a decision node (sums options that share a route). */
export function routeMass(node, answer) {
  const probs = optionProbs(node.question, answer);
  const mass = {};
  for (const [k, p] of Object.entries(probs)) {
    const rk = routeKeyForOption(node, k);
    if (rk !== undefined) mass[rk] = round4((mass[rk] || 0) + p);
  }
  return mass;
}

const round4 = (x) => Math.round(x * 1e4) / 1e4;

/** Fill {{path.to.value}} placeholders from a context object. */
export function template(str, ctx) {
  return String(str ?? "").replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_, path) => {
    const v = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

/** Short stable fingerprint of a question, so recorded answers are only reused while the question is unchanged. */
export function questionKey(q) {
  const s = JSON.stringify(q);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Build the Laya `state` for a workflow input. */
export function buildState(wf, input) {
  if (wf.input?.subject) return { [wf.input.key || "message"]: { subject: input.subject || "(no subject)", text: input.text } };
  return input.text;
}

// ---- validation ---------------------------------------------------------------------------

/** Returns a list of human-readable problems; empty means the workflow is valid. */
export function validateWorkflow(wf) {
  const errs = [];
  if (!wf || typeof wf !== "object") return ["workflow must be an object"];
  if (!wf.id) errs.push("missing id");
  if (!wf.name) errs.push("missing name");
  const nodes = wf.nodes || {};
  if (!Object.keys(nodes).length) errs.push("workflow has no nodes");
  if (!nodes[wf.start]) errs.push(`start node "${wf.start}" does not exist`);
  const ref = (from, to, what) => { if (!nodes[to]) errs.push(`${from}: ${what} points to missing node "${to}"`); };
  for (const [id, n] of Object.entries(nodes)) {
    if (n.type === "decision") {
      const q = n.question;
      if (!q || !["choice", "score", "noul"].includes(q.type)) { errs.push(`${id}: question.type must be choice, score or noul`); continue; }
      if (!q.instructions) errs.push(`${id}: question.instructions is required`);
      if (q.type === "choice" && (!q.criteria || optionKeys(q).length < 2)) errs.push(`${id}: a choice question needs at least 2 criteria`);
      if (q.type === "score" && (!Array.isArray(q.criteria) || q.criteria.length < 2)) errs.push(`${id}: a score question needs an array of at least 2 levels`);
      const routes = n.routes || {};
      for (const [rk, to] of Object.entries(routes)) {
        ref(id, to, `route "${rk}"`);
        if (q.type === "score" && !parseRange(rk)) errs.push(`${id}: score route "${rk}" must look like "2", "0-1" or "2+"`);
        if (q.type === "noul" && !["true", "false"].includes(rk)) errs.push(`${id}: yes/no routes must be "true" or "false"`);
        if (q.type === "choice" && !optionKeys(q).includes(rk)) errs.push(`${id}: route "${rk}" is not one of the criteria`);
      }
      const unrouted = optionKeys(q).filter((k) => routeKeyForOption(n, k) === undefined);
      if (unrouted.length) errs.push(`${id}: no route for option(s) ${unrouted.map((k) => `"${optionLabel(q, k)}"`).join(", ")}`);
      if (n.onLowConfidence) ref(id, n.onLowConfidence, "onLowConfidence");
      if (n.minConfidence != null && !(n.minConfidence >= 0 && n.minConfidence <= 1)) errs.push(`${id}: minConfidence must be between 0 and 1`);
      if (n.cutoff != null && (q.type !== "noul" || !(n.cutoff > 0 && n.cutoff < 1))) errs.push(`${id}: cutoff is for yes/no questions and must be between 0 and 1`);
    } else if (n.type === "task") {
      if (!n.next) errs.push(`${id}: a task needs "next"`); else ref(id, n.next, "next");
    } else if (n.type === "outcome") {
      if (!DISPOSITIONS[n.disposition]) errs.push(`${id}: outcome disposition must be auto, human or block`);
    } else {
      errs.push(`${id}: unknown node type "${n.type}" (use decision, task or outcome)`);
    }
  }
  if (!errs.length) {
    const cyc = findCycle(wf);
    if (cyc) errs.push(`cycle: ${cyc.join(" → ")} (workflows must be acyclic)`);
    const reach = reachable(wf);
    const orphans = Object.keys(nodes).filter((id) => !reach.has(id));
    if (orphans.length) errs.push(`unreachable node(s): ${orphans.join(", ")}`);
  }
  return errs;
}

/** All outgoing edges of the workflow: {from, to, kind, key}. kind: route | low | next */
export function edgesOf(wf) {
  const out = [];
  for (const [id, n] of Object.entries(wf.nodes || {})) {
    if (n.type === "decision") {
      for (const [rk, to] of Object.entries(n.routes || {})) out.push({ from: id, to, kind: "route", key: rk });
      if (n.onLowConfidence) out.push({ from: id, to: n.onLowConfidence, kind: "low", key: LOW });
    } else if (n.type === "task" && n.next) out.push({ from: id, to: n.next, kind: "next", key: "next" });
  }
  return out;
}

function reachable(wf) {
  const seen = new Set(), stack = [wf.start], adj = adjacency(wf);
  while (stack.length) { const id = stack.pop(); if (seen.has(id) || !wf.nodes[id]) continue; seen.add(id); stack.push(...(adj[id] || [])); }
  return seen;
}
function adjacency(wf) {
  const adj = {};
  for (const e of edgesOf(wf)) (adj[e.from] ||= []).push(e.to);
  return adj;
}
function findCycle(wf) {
  const adj = adjacency(wf), color = {}, parent = {};
  for (const s of Object.keys(wf.nodes)) {
    if (color[s]) continue;
    const stack = [[s, 0]]; color[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1], [u, i] = top, nb = adj[u] || [];
      if (i < nb.length) {
        top[1]++; const v = nb[i];
        if (color[v] === 1) { const path = [v]; let x = u; while (x !== v) { path.push(x); x = parent[x]; } path.push(v); return path.reverse(); }
        if (!color[v] && wf.nodes[v]) { color[v] = 1; parent[v] = u; stack.push([v, 0]); }
      } else { color[u] = 2; stack.pop(); }
    }
  }
  return null;
}

/** Decision nodes of a workflow (used to precompute or batch every question at once). */
export function decisionNodes(wf) {
  return Object.entries(wf.nodes).filter(([, n]) => n.type === "decision").map(([id, n]) => ({ id, node: n }));
}

// ---- execution ----------------------------------------------------------------------------

/**
 * Run a workflow on one input.
 * @param wf        workflow definition
 * @param input     { text, subject? }
 * @param ask       async (question, state, nodeId) => Laya answer ({type, choice|score|noul, probabilities, confidence})
 * @param opts      { threshold (default 0.6), onStep(step) }
 * @returns trace   { workflowId, input, state, steps[], outcome, effects[], minConfidence, lowConfidence, totalMs }
 */
export async function runWorkflow(wf, input, ask, opts = {}) {
  const threshold = opts.threshold ?? 0.6;
  const state = buildState(wf, input);
  const answers = {};
  const steps = [], effects = [];
  const t0 = now();
  let id = wf.start, outcome = null;
  for (let guard = 0; guard < MAX_STEPS && id; guard++) {
    const node = wf.nodes[id];
    if (!node) throw new Error(`node "${id}" does not exist`);
    if (node.type === "decision") {
      const s0 = now();
      const answer = await ask(node.question, state, id);
      const q = node.question;
      const { selected: opt, routeKey, p, mass } = branchOf(node, answer);
      const thr = node.minConfidence ?? threshold;
      const low = p < thr;
      const to = low && node.onLowConfidence ? node.onLowConfidence : node.routes[routeKey];
      answers[id] = { ...answer, selected: opt, label: optionLabel(q, opt) };
      const step = {
        nodeId: id, kind: "decision", label: node.label || q.instructions, question: q, answer, selected: opt,
        selectedLabel: optionLabel(q, opt), probs: optionProbs(q, answer), routeMass: mass, cutoff: node.cutoff,
        confidence: p, layaConfidence: answer.confidence, threshold: thr, lowConfidence: low, escalated: low && !!node.onLowConfidence,
        routeKey: low && node.onLowConfidence ? LOW : routeKey, to, ms: now() - s0,
      };
      steps.push(step); await opts.onStep?.(step);
      id = to;
    } else if (node.type === "task") {
      const ctx = { input, answers, workflow: { id: wf.id, name: wf.name } };
      const effect = { nodeId: id, channel: node.channel || "task", label: node.label, text: template(node.template || node.label, ctx), at: new Date().toISOString() };
      effects.push(effect);
      const step = { nodeId: id, kind: "task", label: node.label, effect, to: node.next };
      steps.push(step); await opts.onStep?.(step);
      id = node.next;
    } else {
      outcome = { nodeId: id, disposition: node.disposition, label: node.label, detail: template(node.detail || "", { input, answers }) };
      steps.push({ nodeId: id, kind: "outcome", label: node.label, disposition: node.disposition });
      await opts.onStep?.(steps[steps.length - 1]);
      break;
    }
  }
  if (!outcome) throw new Error(`workflow "${wf.id}" did not reach an outcome within ${MAX_STEPS} steps`);
  const dec = steps.filter((s) => s.kind === "decision");
  return {
    id: opts.runId || `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    workflowId: wf.id, workflowName: wf.name, input, state, threshold, steps, outcome, effects, answers,
    minConfidence: dec.length ? Math.min(...dec.map((s) => s.confidence)) : 1,
    lowConfidence: dec.some((s) => s.lowConfidence),
    totalMs: now() - t0, at: new Date().toISOString(), source: opts.source || "model",
  };
}

/**
 * Replay a stored run at a different threshold without calling the model again. Works when every decision node
 * that the new path visits has a recorded answer (the precomputed examples record all of them).
 */
export async function replayAt(wf, run, threshold, allAnswers) {
  const pool = { ...(allAnswers || {}), ...run.answers };
  return runWorkflow(wf, run.input, async (_q, _s, id) => {
    const a = pool[id];
    if (!a) throw new Error(`no recorded answer for node "${id}"`);
    return a;
  }, { threshold, runId: run.id, source: run.source });
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
