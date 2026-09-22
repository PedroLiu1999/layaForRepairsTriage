import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkflow, runWorkflow, parseRange, routeMass, edgesOf, replayAt, template, LOW } from "../web/engine.js";
import { WORKFLOWS } from "../web/workflows.js";
import { buildOntology, toTurtle, toJsonLd } from "../web/ontology.js";

// Fake Laya answers in the same shape laya-core.js returns.
const choice = (probs, confidence = 0.9) => {
  const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
  return { type: "choice", choice, probabilities: probs, confidence };
};
const score = (probs, confidence = 0.9) => ({
  type: "score", score: probs.reduce((a, p, i) => a + i * p, 0),
  probabilities: Object.fromEntries(probs.map((p, i) => [String(i), p])), confidence,
});
const noul = (p) => ({ type: "noul", noul: p, confidence: Math.max(p, 1 - p) });

test("every built-in workflow is valid", () => {
  for (const wf of WORKFLOWS) assert.deepEqual(validateWorkflow(wf), [], wf.id);
});

test("every built-in workflow has unique ids and examples", () => {
  assert.equal(new Set(WORKFLOWS.map((w) => w.id)).size, WORKFLOWS.length);
  for (const wf of WORKFLOWS) assert.ok(wf.examples.length >= 3, wf.id);
});

test("parseRange", () => {
  assert.deepEqual(parseRange("2"), [2, 2]);
  assert.deepEqual(parseRange("0-1"), [0, 1]);
  assert.deepEqual(parseRange("2+"), [2, Infinity]);
  assert.equal(parseRange("x"), null);
});

test("validation catches missing routes, cycles and orphans", () => {
  const base = () => ({
    id: "t", name: "t", start: "a",
    nodes: {
      a: { type: "decision", question: { type: "noul", instructions: "x" }, routes: { true: "b", false: "c" } },
      b: { type: "outcome", disposition: "auto" }, c: { type: "outcome", disposition: "human" },
    },
  });
  assert.deepEqual(validateWorkflow(base()), []);
  const missing = base(); delete missing.nodes.a.routes.false;
  assert.match(validateWorkflow(missing).join(), /no route for option/);
  const cyc = base(); cyc.nodes.c = { type: "task", next: "a" };
  assert.match(validateWorkflow(cyc).join(), /cycle/);
  const orphan = base(); orphan.nodes.z = { type: "outcome", disposition: "auto" };
  assert.match(validateWorkflow(orphan).join(), /unreachable/);
  const badScore = { ...base(), start: "s", nodes: { ...base().nodes, s: { type: "decision", question: { type: "score", instructions: "x", criteria: ["a", "b", "c"] }, routes: { "0-1": "a" } } } };
  assert.match(validateWorkflow(badScore).join(), /no route for option\(s\) "2: c"/);
});

test("support triage: confident bug, urgent -> page on-call", async () => {
  const wf = WORKFLOWS.find((w) => w.id === "support-triage");
  const ask = async (q, state, id) => {
    assert.equal(state.ticket.subject, "Crash");
    if (id === "category") return choice({ bug: 0.9, how_to: 0.05, billing: 0.03, account_access: 0.02 }, 0.8);
    if (id === "urgency") return score([0.02, 0.03, 0.15, 0.8], 0.6);
    throw new Error("unexpected " + id);
  };
  const run = await runWorkflow(wf, { subject: "Crash", text: "down" }, ask, { threshold: 0.5 });
  assert.deepEqual(run.steps.map((s) => s.nodeId), ["category", "urgency", "page_oncall", "filed"]);
  assert.equal(run.outcome.disposition, "auto");
  assert.equal(run.effects[0].text, "PAGE on-call: Crash");
  assert.equal(run.minConfidence, 0.6);
});

test("low confidence follows onLowConfidence", async () => {
  const wf = WORKFLOWS.find((w) => w.id === "support-triage");
  const run = await runWorkflow(wf, { subject: "?", text: "hmm" }, async () => choice({ bug: 0.3, how_to: 0.3, billing: 0.2, account_access: 0.2 }, 0.1), { threshold: 0.5 });
  assert.equal(run.steps[0].routeKey, LOW);
  assert.equal(run.outcome.nodeId, "human_triage");
  assert.equal(run.lowConfidence, true);
});

test("routeMass sums options sharing a score route", () => {
  const wf = WORKFLOWS.find((w) => w.id === "support-triage");
  const m = routeMass(wf.nodes.urgency, score([0.1, 0.2, 0.3, 0.4]));
  assert.deepEqual(m, { "0-1": 0.3, "2": 0.3, "3": 0.4 });
});

test("replayAt re-routes a stored run at a new threshold without the model", async () => {
  const wf = WORKFLOWS.find((w) => w.id === "refund-request");
  const answers = { reason: choice({ damaged: 0.7, not_received: 0.1, changed_mind: 0.1, wrong_item: 0.1 }, 0.55), photo: noul(0.9) };
  const run = await runWorkflow(wf, { text: "broken" }, async (_q, _s, id) => answers[id], { threshold: 0.5 });
  assert.equal(run.outcome.nodeId, "auto_done");
  const strict = await replayAt(wf, run, 0.7, answers);
  assert.equal(strict.outcome.nodeId, "agent");
});

test("edgesOf lists routes, low-confidence and next edges", () => {
  const wf = WORKFLOWS.find((w) => w.id === "content-moderation");
  const kinds = new Set(edgesOf(wf).map((e) => e.kind));
  assert.deepEqual([...kinds].sort(), ["low", "next", "route"]);
});

test("template fills nested placeholders", () => {
  assert.equal(template("a {{x.y}} b {{missing}}", { x: { y: 3 } }), "a 3 b ");
});

test("ontology exports parse-able turtle and json-ld with runs as individuals", async () => {
  const wf = WORKFLOWS.find((w) => w.id === "agent-guardrail");
  const run = await runWorkflow(wf, { text: "delete prod" }, async () => noul(0.95), { threshold: 0.5, runId: "run-1" });
  const onto = buildOntology(WORKFLOWS, [run]);
  const ttl = toTurtle(onto);
  assert.match(ttl, /@prefix lw: </);
  assert.match(ttl, /lw:DecisionNode rdfs:subClassOf lw:Node/);
  assert.match(ttl, /run_run-1 a lw:Run/);
  assert.match(ttl, /lw:selected /);
  const jl = toJsonLd(onto);
  assert.ok(Array.isArray(jl["@graph"]) && jl["@graph"].length > 50);
  assert.equal(JSON.parse(JSON.stringify(jl))["@context"].lw.startsWith("https://"), true);
});
