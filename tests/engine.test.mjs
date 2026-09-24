import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkflow, runWorkflow, parseRange, routeMass, branchOf, edgesOf, replayAt, template, LOW } from "../web/engine.js";
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

test("awaab-triage: emergency danger -> dispatch emergency make-safe", async () => {
  const wf = WORKFLOWS.find((w) => w.id === "awaab-triage");
  const ask = async (q, state, id) => {
    assert.equal(state, "Gas leak");
    if (id === "emergency_danger") return noul(0.95);
    throw new Error("unexpected " + id);
  };
  const run = await runWorkflow(wf, { text: "Gas leak" }, ask, { threshold: 0.5 });
  assert.deepEqual(run.steps.map((s) => s.nodeId), ["emergency_danger", "make_safe_24h", "emergency_outcome"]);
  assert.equal(run.outcome.disposition, "human");
  assert.equal(run.effects[0].text, "EMERGENCY report: Gas leak");
  assert.equal(run.minConfidence, 0.95);
});

test("low confidence follows onLowConfidence", async () => {
  const wf = WORKFLOWS.find((w) => w.id === "awaab-triage");
  const run = await runWorkflow(wf, { text: "vague" }, async () => noul(0.5, 0.1), { threshold: 0.5 });
  assert.equal(run.steps[0].routeKey, LOW);
  assert.equal(run.outcome.nodeId, "urgent_review");
  assert.equal(run.lowConfidence, true);
});

test("routeMass sums options sharing a score route", () => {
  const wf = WORKFLOWS.find((w) => w.id === "awaab-triage");
  const m = routeMass(wf.nodes.severity, score([0.1, 0.2, 0.3, 0.4]));
  assert.deepEqual(m, { "0-1": 0.3, "2+": 0.7 });
});

test("yes/no cutoff makes a fail-closed gate", () => {
  const wf = WORKFLOWS.find((w) => w.id === "awaab-triage");
  const b = branchOf(wf.nodes.emergency_danger, noul(0.35)); // cutoff 0.3 -> "true"
  assert.equal(b.selected, "true"); assert.equal(b.routeKey, "true"); assert.equal(b.p, 0.35);
  assert.equal(branchOf(wf.nodes.emergency_danger, noul(0.2)).selected, "false");
  const bad = structuredClone(wf); bad.nodes.category.cutoff = 0.3;
  assert.match(validateWorkflow(bad).join(), /cutoff is for yes\/no questions/);
});

test("replayAt re-routes a stored run at a new threshold without the model", async () => {
  const wf = WORKFLOWS.find((w) => w.id === "awaab-triage");
  const answers = {
    emergency_danger: noul(0.02, 0.98),
    essential_service: noul(0.01, 0.99),
    category: choice({ general_repair: 0.7, falls_structural: 0.1, damp_mould: 0.1, cold_heat: 0.05, fire_electrical: 0.03, hygiene_pests: 0.02 }, 0.55),
    hidden_hazard: noul(0.05, 0.95),
  };
  const run = await runWorkflow(wf, { text: "cupboard hinge loose" }, async (_q, _s, id) => answers[id], { threshold: 0.5 });
  assert.equal(run.outcome.nodeId, "routine_outcome");
  const strict = await replayAt(wf, run, 0.75, answers);
  assert.equal(strict.outcome.nodeId, "triage_officer");
});

test("edgesOf lists routes, low-confidence and next edges", () => {
  const wf = WORKFLOWS.find((w) => w.id === "awaab-triage");
  const kinds = new Set(edgesOf(wf).map((e) => e.kind));
  assert.deepEqual([...kinds].sort(), ["low", "next", "route"]);
});

test("template fills nested placeholders", () => {
  assert.equal(template("a {{x.y}} b {{missing}}", { x: { y: 3 } }), "a 3 b ");
});

test("ontology exports parse-able turtle and json-ld with runs as individuals", async () => {
  const wf = WORKFLOWS.find((w) => w.id === "awaab-triage");
  const ask = async (q, _s, id) => {
    if (id === "emergency_danger") return noul(0.95);
    return noul(0.9);
  };
  const run = await runWorkflow(wf, { text: "gas leak" }, ask, { threshold: 0.5, runId: "run-1" });
  assert.equal(run.outcome.nodeId, "emergency_outcome");
  const onto = buildOntology(WORKFLOWS, [run]);
  const ttl = toTurtle(onto);
  assert.match(ttl, /@prefix lw: </);
  assert.match(ttl, /lw:DecisionNode rdfs:subClassOf lw:Node/);
  assert.match(ttl, /run_run-1 a lw:Run/);
  const jl = toJsonLd(onto);
  assert.ok(Array.isArray(jl["@graph"]) && jl["@graph"].length > 10);
  assert.equal(JSON.parse(JSON.stringify(jl))["@context"].lw.startsWith("https://"), true);
});

test("recorded.json matches the built-in examples and questions", async () => {
  const { readFileSync } = await import("node:fs");
  const { decisionNodes, questionKey } = await import("../web/engine.js");
  const rec = JSON.parse(readFileSync(new URL("../web/recorded.json", import.meta.url), "utf8"));
  for (const wf of WORKFLOWS) {
    const list = rec.workflows[wf.id];
    assert.equal(list?.length, wf.examples.length, `${wf.id}: re-record after changing examples (see README)`);
    list.forEach((x, i) => {
      assert.equal(x.text, wf.examples[i].text, `${wf.id} example ${i}`);
      for (const { id, node } of decisionNodes(wf)) assert.equal(x.questions[id], questionKey(node.question), `${wf.id}.${id}: question changed, re-record`);
    });
    for (const x of list) { const run = await runWorkflow(wf, x, async (_q, _s, id) => x.answers[id], { threshold: 0.5 }); assert.ok(run.outcome); }
  }
});

test("laya-core clamps calibration temperature like Python's clamp_temperature (layaForWeb#1)", async () => {
  const { clampTemperature } = await import("../web/laya-core.js");
  assert.equal(clampTemperature(0.10058280825614929), 0.5);   // the checkpoints' choice:11+ bucket
  assert.equal(clampTemperature(1.7601518630981445), 1.7601518630981445); // in-range buckets are untouched
  assert.equal(clampTemperature(9), 5.0);
  assert.equal(clampTemperature("2.5"), 2.5);
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, "", "abc", {}]) assert.equal(clampTemperature(bad), 1.0);
});
