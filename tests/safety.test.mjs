import test from "node:test";
import assert from "node:assert/strict";
import { WORKFLOWS } from "../web/workflows.js";
import { enumeratePaths, checkSafety } from "../web/safety.js";

const wf = WORKFLOWS.find((w) => w.id === "awaab-triage");

test("built-in awaab-triage workflow exists", () => {
  assert.ok(wf, "awaab-triage workflow must exist in WORKFLOWS");
  assert.equal(wf.id, "awaab-triage");
});

test("built-in workflow passes checkSafety with 0 violations", () => {
  const violations = checkSafety(wf);
  assert.deepEqual(violations, [], `Expected 0 violations, got: ${violations.join("; ")}`);
});

test("every path ending in an auto outcome goes through emergency_danger -> false, essential_service -> false, and hidden_hazard -> false", () => {
  const paths = enumeratePaths(wf);
  assert.ok(paths.length > 0, "Workflow should have enumerated paths");

  const autoPaths = paths.filter((p) => {
    const end = p[p.length - 1];
    const endNode = wf.nodes[end.nodeId];
    return endNode && endNode.type === "outcome" && endNode.disposition === "auto";
  });

  assert.ok(autoPaths.length > 0, "There should be at least one auto path");

  for (const path of autoPaths) {
    const passesEmergencyFalse = path.some(
      (s) => s.nodeId === "emergency_danger" && s.edgeKey === "false"
    );
    const passesEssentialFalse = path.some(
      (s) => s.nodeId === "essential_service" && s.edgeKey === "false"
    );
    const passesHiddenHazardFalse = path.some(
      (s) => s.nodeId === "hidden_hazard" && s.edgeKey === "false"
    );

    assert.ok(passesEmergencyFalse, "Auto path must pass emergency_danger on false");
    assert.ok(passesEssentialFalse, "Auto path must pass essential_service on false");
    assert.ok(passesHiddenHazardFalse, "Auto path must pass hidden_hazard on false");
  }
});

test("no outcome other than routine_outcome is auto", () => {
  for (const [id, node] of Object.entries(wf.nodes)) {
    if (node.type === "outcome") {
      if (node.disposition === "auto") {
        assert.equal(id, "routine_outcome", `Outcome "${id}" should not have auto disposition`);
      }
    }
  }
});

test("every node reachable from an onLowConfidence edge leads only to human outcomes", () => {
  const paths = enumeratePaths(wf);
  const lowPaths = paths.filter((p) => p.some((s) => s.edgeKey === "low"));
  assert.ok(lowPaths.length > 0, "Expected paths with low-confidence edges");

  for (const p of lowPaths) {
    const end = p[p.length - 1];
    const endNode = wf.nodes[end.nodeId];
    assert.equal(
      endNode.disposition,
      "human",
      `Path with low confidence must end in human outcome, ended in ${end.nodeId} (${endNode.disposition})`
    );
  }
});

test("mutation test: rerouting category.general_repair straight to routine_repair causes violation", () => {
  const mutated = JSON.parse(JSON.stringify(wf));
  mutated.nodes.category.routes.general_repair = "routine_repair";
  const violations = checkSafety(mutated);
  assert.ok(violations.length > 0, "Expected violation when bypassing hidden_hazard");
  assert.ok(
    violations.some((v) => v.includes("hidden_hazard") || v.includes("Auto path")),
    `Expected hidden_hazard violation, got: ${violations.join("; ")}`
  );
});

test("mutation test: making urgent_review auto causes violation", () => {
  const mutated = JSON.parse(JSON.stringify(wf));
  mutated.nodes.urgent_review.disposition = "auto";
  const violations = checkSafety(mutated);
  assert.ok(violations.length > 0, "Expected violation when urgent_review is auto");
  assert.ok(
    violations.some((v) => v.includes("urgent_review")),
    `Expected urgent_review violation, got: ${violations.join("; ")}`
  );
});

test("mutation test: deleting essential_service node causes violation", () => {
  const mutated = JSON.parse(JSON.stringify(wf));
  delete mutated.nodes.essential_service;
  mutated.nodes.emergency_danger.routes.false = "category";
  const violations = checkSafety(mutated);
  assert.ok(violations.length > 0, "Expected violation when essential_service is deleted");
  assert.ok(
    violations.some((v) => v.includes("essential_service")),
    `Expected essential_service violation, got: ${violations.join("; ")}`
  );
});
