// Evaluation runner for layaForRepairsTriage.
// Evaluates 162 synthetic reports across thresholds 0.3 to 0.9 using the real workflow engine.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKFLOWS } from "../web/workflows.js";
import { preCheck, postCheck } from "../web/intake.js";
import { runWorkflow } from "../web/engine.js";
import { deriveTrack } from "../web/compliance.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = path.resolve(__dirname, ".");
const REPORTS_FILE = path.join(EVAL_DIR, "reports.jsonl");
const ANSWERS_FILE = path.join(EVAL_DIR, "answers.json");

if (!fs.existsSync(REPORTS_FILE) || !fs.existsSync(ANSWERS_FILE)) {
  console.error("Missing reports.jsonl or answers.json");
  process.exit(1);
}

const reports = fs
  .readFileSync(REPORTS_FILE, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const answersData = JSON.parse(fs.readFileSync(ANSWERS_FILE, "utf8")).answers;
const wf = WORKFLOWS.find((w) => w.id === "awaab-triage");

const thresholds = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const results = [];

for (const t of thresholds) {
  let emergencyMisses = 0;
  let totalEmergencies = 0;
  let unsafeAutomations = 0;
  let totalNonRoutine = 0;
  let routineAutomations = 0;
  let totalRoutine = 0;
  let humanDispositions = 0;
  let totalReports = reports.length;
  let vulnDetected = 0;
  let totalVuln = 0;

  // Category tracking
  let catMatches = 0;
  let catTotal = 0;
  const categories = ["damp_mould", "cold_heat", "fire_electrical", "falls_structural", "hygiene_pests", "general_repair"];
  const confusion = {};
  for (const c of categories) {
    confusion[c] = {};
    for (const c2 of categories) confusion[c][c2] = 0;
  }

  for (const rep of reports) {
    const input = { text: rep.text, subject: rep.subject || "" };
    const ans = answersData[rep.id];

    const isEmerg = rep.expected_track === "emergency";
    const isNonRoutine = rep.expected_track !== "routine";
    const isRoutine = rep.expected_track === "routine";
    const isVuln = !!rep.expected_vulnerable;

    if (isEmerg) totalEmergencies++;
    if (isNonRoutine) totalNonRoutine++;
    if (isRoutine) totalRoutine++;
    if (isVuln) totalVuln++;

    // 1. Intake pre-check
    const pre = preCheck(input.text);
    let run = null;

    if (!pre.proceed) {
      run = {
        workflowId: wf.id,
        threshold: t,
        source: "intake_guard",
        outcome: { nodeId: "triage_officer", disposition: "human", label: pre.forcedOutcome },
        steps: [],
        effects: [],
      };
    } else {
      // 2. Execute workflow with real engine and recorded answers
      const ask = async (q, state, nodeId) => {
        return ans[nodeId];
      };
      run = await runWorkflow(wf, input, ask, { threshold: t });
    }

    // 3. Post-check tripwires
    const post = postCheck(run, pre.flags);
    if (post.escalate) {
      run.outcome = { nodeId: "urgent_review", disposition: "human", label: "Urgent review (tripwire)" };
      run.tripwireEscalated = true;
    }

    // Derive track
    const track = deriveTrack(run, { ...pre.flags, tripwireEscalated: post.escalate });

    // Track disposition
    if (run.outcome.disposition === "human") {
      humanDispositions++;
    }

    // Check emergency miss
    if (isEmerg) {
      if (track !== "emergency" && run.outcome.nodeId !== "urgent_review") {
        emergencyMisses++;
        if (t === 0.5) {
          console.log(`[EMERGENCY MISS] ${rep.id} (${rep.subject}) -> got track: ${track}, outcome: ${run.outcome.nodeId}`);
        }
      }
    }

    // Check unsafe automation
    if (isNonRoutine) {
      if (run.outcome.nodeId === "routine_outcome") {
        unsafeAutomations++;
        if (t === 0.5) {
          console.log(`[UNSAFE AUTO] ${rep.id} (${rep.subject}) [exp: ${rep.expected_track}] -> reached routine_outcome`);
        }
      }
    }

    // Check routine automation
    if (isRoutine) {
      if (run.outcome.nodeId === "routine_outcome") {
        routineAutomations++;
      }
    }

    // Check vulnerability detection
    const hasVulnStep = run.steps.some((s) => s.nodeId === "vulnerable" && s.selected === "true") ||
                        run.steps.some((s) => s.nodeId === "flag_vulnerable");
    if (isVuln && hasVulnStep) {
      vulnDetected++;
    }

    // Category confusion
    const catStep = run.steps.find((s) => s.nodeId === "category");
    if (rep.expected_category && categories.includes(rep.expected_category)) {
      catTotal++;
      const pred = catStep?.selected || "general_repair";
      if (categories.includes(pred)) {
        confusion[rep.expected_category][pred]++;
        if (pred === rep.expected_category) catMatches++;
      }
    }
  }

  results.push({
    threshold: t,
    totalReports,
    emergencyMissRate: emergencyMisses / totalEmergencies,
    emergencyMisses,
    totalEmergencies,
    unsafeAutomationRate: unsafeAutomations / totalNonRoutine,
    unsafeAutomations,
    routineAutomationRate: routineAutomations / totalRoutine,
    routineAutomations,
    totalRoutine,
    humanReviewLoad: humanDispositions / totalReports,
    vulnerabilityRecall: totalVuln ? vulnDetected / totalVuln : 1,
    categoryAccuracy: catTotal ? catMatches / catTotal : 1,
    confusion,
  });
}

// Print Results Table
console.log("==========================================================================================");
console.log("                    layaForRepairsTriage EVALUATION METRICS REPORT                        ");
console.log("==========================================================================================");
console.log(`Evaluated ${reports.length} synthetic cases across thresholds 0.30 - 0.90`);
console.log("------------------------------------------------------------------------------------------");
console.log("Thresh | Emerg Miss | Unsafe Auto | Routine Auto | Human Load | Vuln Recall | Cat Acc");
console.log("------------------------------------------------------------------------------------------");

for (const r of results) {
  const tStr = r.threshold.toFixed(2);
  const emStr = (r.emergencyMissRate * 100).toFixed(1) + "% (" + r.emergencyMisses + "/" + r.totalEmergencies + ")";
  const uaStr = (r.unsafeAutomationRate * 100).toFixed(1) + "% (" + r.unsafeAutomations + ")";
  const raStr = (r.routineAutomationRate * 100).toFixed(1) + "% (" + r.routineAutomations + "/" + r.totalRoutine + ")";
  const hlStr = (r.humanReviewLoad * 100).toFixed(1) + "%";
  const vrStr = (r.vulnerabilityRecall * 100).toFixed(1) + "%";
  const caStr = (r.categoryAccuracy * 100).toFixed(1) + "%";

  console.log(`${tStr.padEnd(6)} | ${emStr.padEnd(10)} | ${uaStr.padEnd(11)} | ${raStr.padEnd(12)} | ${hlStr.padEnd(10)} | ${vrStr.padEnd(11)} | ${caStr}`);
}
console.log("==========================================================================================");

// Write results to JSON for documentation
fs.writeFileSync(path.join(EVAL_DIR, "eval_summary.json"), JSON.stringify(results, null, 2), "utf8");
console.log(`Saved evaluation summary to ${path.join(EVAL_DIR, "eval_summary.json")}`);
