import { LOW } from "./engine.js";

/**
 * Enumerate all execution paths from wf.start to every outcome node.
 * Each path is an array of { nodeId, edgeKey }.
 * For terminal outcome nodes, edgeKey is null.
 *
 * @param {object} wf - The workflow definition
 * @returns {Array<Array<{ nodeId: string, edgeKey: string|null }>>}
 */
export function enumeratePaths(wf) {
  if (!wf || !wf.start || !wf.nodes || !wf.nodes[wf.start]) {
    return [];
  }

  const paths = [];
  const visitedOnCurrentPath = new Set();

  function dfs(currId, currentPath) {
    const node = wf.nodes[currId];
    if (!node) {
      // Dangling node pointer
      paths.push([...currentPath, { nodeId: currId, edgeKey: null }]);
      return;
    }

    if (node.type === "outcome") {
      paths.push([...currentPath, { nodeId: currId, edgeKey: null }]);
      return;
    }

    if (visitedOnCurrentPath.has(currId)) {
      // Cycle guard: terminate path here
      paths.push([...currentPath, { nodeId: currId, edgeKey: "cycle" }]);
      return;
    }

    visitedOnCurrentPath.add(currId);

    if (node.type === "task") {
      if (node.next) {
        currentPath.push({ nodeId: currId, edgeKey: "next" });
        dfs(node.next, currentPath);
        currentPath.pop();
      } else {
        paths.push([...currentPath, { nodeId: currId, edgeKey: null }]);
      }
    } else if (node.type === "decision") {
      // Route branches
      if (node.routes) {
        for (const [routeKey, targetId] of Object.entries(node.routes)) {
          currentPath.push({ nodeId: currId, edgeKey: routeKey });
          dfs(targetId, currentPath);
          currentPath.pop();
        }
      }
      // Low confidence branch
      if (node.onLowConfidence) {
        currentPath.push({ nodeId: currId, edgeKey: "low" });
        dfs(node.onLowConfidence, currentPath);
        currentPath.pop();
      }
    }

    visitedOnCurrentPath.delete(currId);
  }

  dfs(wf.start, []);
  return paths;
}

/**
 * Check workflow safety against policy invariants.
 *
 * Policy:
 * {
 *   autoOutcomes: ["routine_outcome"],
 *   mustPassFalse: ["emergency_danger", "essential_service"],
 *   mustPassOneOfFalse: [["hidden_hazard"]],
 *   lowConfidenceMustBeHuman: true,
 *   forbiddenDispositions: ["block"]
 * }
 *
 * @param {object} wf - The workflow definition
 * @param {object} [policy] - Optional override policy (defaults to wf.safety)
 * @returns {string[]} List of human-readable safety violations (empty if safe)
 */
export function checkSafety(wf, policy) {
  const p = policy || wf.safety || {};
  const violations = [];

  if (!wf || !wf.nodes) {
    return ["Workflow has no nodes."];
  }

  const allowedAuto = new Set(p.autoOutcomes || ["routine_outcome"]);
  const forbiddenDispositions = new Set(p.forbiddenDispositions || ["block"]);
  const mustPassFalse = p.mustPassFalse || [];
  const mustPassOneOfFalse = p.mustPassOneOfFalse || [];
  const lowConfidenceMustBeHuman = p.lowConfidenceMustBeHuman ?? true;

  // 1. Verify existence of required nodes in policy
  for (const reqId of mustPassFalse) {
    if (!wf.nodes[reqId]) {
      violations.push(`Required safety gate node "${reqId}" is missing from workflow.`);
    }
  }
  for (const group of mustPassOneOfFalse) {
    for (const reqId of group) {
      if (!wf.nodes[reqId]) {
        violations.push(`Required safety gate node "${reqId}" from group [${group.join(", ")}] is missing from workflow.`);
      }
    }
  }

  // 2. Check individual node dispositions
  for (const [id, node] of Object.entries(wf.nodes)) {
    if (node.type === "outcome") {
      if (node.disposition === "auto" && !allowedAuto.has(id)) {
        violations.push(`Outcome "${id}" has disposition "auto" which is not allowed by policy.autoOutcomes.`);
      }
      if (forbiddenDispositions.has(node.disposition)) {
        violations.push(`Outcome "${id}" has forbidden disposition "${node.disposition}".`);
      }
    }
  }

  // 3. Check paths
  const paths = enumeratePaths(wf);

  for (const path of paths) {
    const endStep = path[path.length - 1];
    const endNode = wf.nodes[endStep.nodeId];
    const isAutoOutcome = endNode && endNode.type === "outcome" && endNode.disposition === "auto";

    if (isAutoOutcome) {
      // Must pass every node in mustPassFalse with edgeKey "false"
      for (const reqId of mustPassFalse) {
        const passed = path.some((step) => step.nodeId === reqId && step.edgeKey === "false");
        if (!passed) {
          violations.push(
            `Auto path to outcome "${endStep.nodeId}" does not take "false" branch at required gate "${reqId}".`
          );
        }
      }

      // Must pass at least one node in each mustPassOneOfFalse group with edgeKey "false"
      for (const group of mustPassOneOfFalse) {
        const passedAny = group.some((reqId) =>
          path.some((step) => step.nodeId === reqId && step.edgeKey === "false")
        );
        if (!passedAny) {
          violations.push(
            `Auto path to outcome "${endStep.nodeId}" does not take "false" branch at any gate in group [${group.join(", ")}].`
          );
        }
      }
    }

    // Low confidence branch checking
    if (lowConfidenceMustBeHuman) {
      const lowIndex = path.findIndex((step) => step.edgeKey === "low" || step.edgeKey === LOW);
      if (lowIndex !== -1) {
        const lowStep = path[lowIndex];
        if (endNode && endNode.disposition !== "human") {
          violations.push(
            `Path following low-confidence edge from "${lowStep.nodeId}" reaches non-human outcome "${endStep.nodeId}" (disposition: "${endNode.disposition || "undefined"}").`
          );
        }
      }
    }
  }

  // Deduplicate violations
  return [...new Set(violations)];
}
