import fs from "node:fs";
import { WORKFLOWS } from "../web/workflows.js";
import { decisionNodes, questionKey } from "../web/engine.js";

const wf = WORKFLOWS.find((w) => w.id === "awaab-triage");
const dNodes = decisionNodes(wf);

const noulAns = (p, conf = Math.max(p, 1 - p)) => ({
  type: "noul",
  noul: p,
  confidence: conf,
});

const choiceAns = (probs, choiceKey, conf = 0.85) => ({
  type: "choice",
  choice: choiceKey,
  probabilities: probs,
  confidence: conf,
});

const scoreAns = (scoreVal, probs = [0.1, 0.2, 0.3, 0.4], conf = 0.85) => ({
  type: "score",
  score: scoreVal,
  probabilities: Object.fromEntries(probs.map((p, i) => [String(i), p])),
  confidence: conf,
});

// Generate realistic mock answers for each of the 20 examples
const exampleAnswers = [
  // 0: smell of gas -> emergency
  {
    emergency_danger: noulAns(0.96, 0.96),
    essential_service: noulAns(0.1, 0.9),
    category: choiceAns({ fire_electrical: 0.8, damp_mould: 0.05, cold_heat: 0.05, falls_structural: 0.02, hygiene_pests: 0.03, general_repair: 0.05 }, "fire_electrical"),
    hidden_hazard: noulAns(0.95, 0.95),
    vulnerable: noulAns(0.1, 0.9),
    severity: scoreAns(3.0, [0.02, 0.03, 0.15, 0.8]),
  },
  // 1: socket sparked -> emergency
  {
    emergency_danger: noulAns(0.93, 0.93),
    essential_service: noulAns(0.1, 0.9),
    category: choiceAns({ fire_electrical: 0.9, damp_mould: 0.02, cold_heat: 0.02, falls_structural: 0.02, hygiene_pests: 0.02, general_repair: 0.02 }, "fire_electrical"),
    hidden_hazard: noulAns(0.92, 0.92),
    vulnerable: noulAns(0.1, 0.9),
    severity: scoreAns(2.8, [0.05, 0.05, 0.4, 0.5]),
  },
  // 2: boiler stopped, no heating/hot water, mum 84 -> essential service emergency + vulnerable
  {
    emergency_danger: noulAns(0.2, 0.8),
    essential_service: noulAns(0.95, 0.95),
    category: choiceAns({ cold_heat: 0.88, damp_mould: 0.02, fire_electrical: 0.02, falls_structural: 0.02, hygiene_pests: 0.02, general_repair: 0.04 }, "cold_heat"),
    hidden_hazard: noulAns(0.9, 0.9),
    vulnerable: noulAns(0.95, 0.95),
    severity: scoreAns(2.6, [0.05, 0.1, 0.5, 0.35]),
  },
  // 3: water pouring through ceiling -> emergency
  {
    emergency_danger: noulAns(0.92, 0.92),
    essential_service: noulAns(0.2, 0.8),
    category: choiceAns({ falls_structural: 0.7, damp_mould: 0.1, fire_electrical: 0.1, cold_heat: 0.02, hygiene_pests: 0.05, general_repair: 0.03 }, "falls_structural"),
    hidden_hazard: noulAns(0.95, 0.95),
    vulnerable: noulAns(0.15, 0.85),
    severity: scoreAns(2.9, [0.02, 0.08, 0.3, 0.6]),
  },
  // 4: front door lock snapped -> emergency
  {
    emergency_danger: noulAns(0.88, 0.88),
    essential_service: noulAns(0.1, 0.9),
    category: choiceAns({ general_repair: 0.7, falls_structural: 0.15, fire_electrical: 0.05, damp_mould: 0.02, cold_heat: 0.03, hygiene_pests: 0.05 }, "general_repair"),
    hidden_hazard: noulAns(0.85, 0.85),
    vulnerable: noulAns(0.1, 0.9),
    severity: scoreAns(2.5, [0.05, 0.15, 0.5, 0.3]),
  },
  // 5: black mould behind baby cot -> significant damp_mould, vulnerable, severe
  {
    emergency_danger: noulAns(0.1, 0.9),
    essential_service: noulAns(0.05, 0.95),
    category: choiceAns({ damp_mould: 0.96, cold_heat: 0.01, fire_electrical: 0.01, falls_structural: 0.01, hygiene_pests: 0.005, general_repair: 0.005 }, "damp_mould"),
    hidden_hazard: noulAns(0.95, 0.95),
    vulnerable: noulAns(0.98, 0.98),
    severity: scoreAns(3.0, [0.01, 0.04, 0.25, 0.7]),
  },
  // 6: condensation on bedroom windows -> significant damp_mould, minor
  {
    emergency_danger: noulAns(0.05, 0.95),
    essential_service: noulAns(0.02, 0.98),
    category: choiceAns({ damp_mould: 0.9, cold_heat: 0.03, fire_electrical: 0.01, falls_structural: 0.01, hygiene_pests: 0.02, general_repair: 0.03 }, "damp_mould"),
    hidden_hazard: noulAns(0.3, 0.7),
    vulnerable: noulAns(0.1, 0.9),
    severity: scoreAns(0.8, [0.55, 0.35, 0.08, 0.02]),
  },
  // 7: bedroom musty, mould on ceiling, asthma -> significant damp_mould, vulnerable
  {
    emergency_danger: noulAns(0.12, 0.88),
    essential_service: noulAns(0.04, 0.96),
    category: choiceAns({ damp_mould: 0.94, cold_heat: 0.02, fire_electrical: 0.01, falls_structural: 0.01, hygiene_pests: 0.01, general_repair: 0.01 }, "damp_mould"),
    hidden_hazard: noulAns(0.88, 0.88),
    vulnerable: noulAns(0.92, 0.92),
    severity: scoreAns(2.3, [0.05, 0.25, 0.5, 0.2]),
  },
  // 8: flat freezing, heating on full, windows don't close -> significant cold_heat
  {
    emergency_danger: noulAns(0.12, 0.88),
    essential_service: noulAns(0.22, 0.78),
    category: choiceAns({ cold_heat: 0.89, damp_mould: 0.03, fire_electrical: 0.01, falls_structural: 0.02, hygiene_pests: 0.01, general_repair: 0.04 }, "cold_heat"),
    hidden_hazard: noulAns(0.82, 0.82),
    vulnerable: noulAns(0.18, 0.82),
    severity: scoreAns(1.6, [0.15, 0.5, 0.25, 0.1]),
  },
  // 9: top-floor flat gets hot in summer -> significant cold_heat
  {
    emergency_danger: noulAns(0.06, 0.94),
    essential_service: noulAns(0.04, 0.96),
    category: choiceAns({ cold_heat: 0.85, damp_mould: 0.02, fire_electrical: 0.01, falls_structural: 0.02, hygiene_pests: 0.02, general_repair: 0.08 }, "cold_heat"),
    hidden_hazard: noulAns(0.38, 0.62),
    vulnerable: noulAns(0.1, 0.9),
    severity: scoreAns(1.2, [0.35, 0.45, 0.15, 0.05]),
  },
  // 10: banister on stairs loose -> significant falls_structural
  {
    emergency_danger: noulAns(0.15, 0.85),
    essential_service: noulAns(0.02, 0.98),
    category: choiceAns({ falls_structural: 0.92, general_repair: 0.04, damp_mould: 0.01, cold_heat: 0.01, fire_electrical: 0.01, hygiene_pests: 0.01 }, "falls_structural"),
    hidden_hazard: noulAns(0.85, 0.85),
    vulnerable: noulAns(0.12, 0.88),
    severity: scoreAns(1.8, [0.1, 0.45, 0.35, 0.1]),
  },
  // 11: crack in living-room wall got wider -> significant falls_structural
  {
    emergency_danger: noulAns(0.15, 0.85),
    essential_service: noulAns(0.02, 0.98),
    category: choiceAns({ falls_structural: 0.9, general_repair: 0.05, damp_mould: 0.02, cold_heat: 0.01, fire_electrical: 0.01, hygiene_pests: 0.01 }, "falls_structural"),
    hidden_hazard: noulAns(0.82, 0.82),
    vulnerable: noulAns(0.1, 0.9),
    severity: scoreAns(2.1, [0.08, 0.35, 0.45, 0.12]),
  },
  // 12: rats in kitchen and droppings -> significant hygiene_pests
  {
    emergency_danger: noulAns(0.14, 0.86),
    essential_service: noulAns(0.03, 0.97),
    category: choiceAns({ hygiene_pests: 0.95, general_repair: 0.02, damp_mould: 0.01, cold_heat: 0.01, fire_electrical: 0.005, falls_structural: 0.005 }, "hygiene_pests"),
    hidden_hazard: noulAns(0.88, 0.88),
    vulnerable: noulAns(0.15, 0.85),
    severity: scoreAns(2.2, [0.05, 0.3, 0.5, 0.15]),
  },
  // 13: only toilet blocked won't flush -> review / essential service vs hygiene
  {
    emergency_danger: noulAns(0.2, 0.8),
    essential_service: noulAns(0.72, 0.72), // near threshold or triggers review
    category: choiceAns({ hygiene_pests: 0.78, essential_service: 0.1, general_repair: 0.08, damp_mould: 0.01, cold_heat: 0.01, falls_structural: 0.01, fire_electrical: 0.01 }, "hygiene_pests"),
    hidden_hazard: noulAns(0.86, 0.86),
    vulnerable: noulAns(0.15, 0.85),
    severity: scoreAns(2.4, [0.05, 0.25, 0.5, 0.2]),
  },
  // 14: kitchen cupboard door hinge loose -> routine
  {
    emergency_danger: noulAns(0.01, 0.99),
    essential_service: noulAns(0.01, 0.99),
    category: choiceAns({ general_repair: 0.95, falls_structural: 0.02, damp_mould: 0.01, cold_heat: 0.005, fire_electrical: 0.005, hygiene_pests: 0.01 }, "general_repair"),
    hidden_hazard: noulAns(0.04, 0.96),
    vulnerable: noulAns(0.05, 0.95),
    severity: scoreAns(0.2, [0.85, 0.12, 0.02, 0.01]),
  },
  // 15: dripping tap in bathroom sink -> routine
  {
    emergency_danger: noulAns(0.02, 0.98),
    essential_service: noulAns(0.02, 0.98),
    category: choiceAns({ general_repair: 0.88, hygiene_pests: 0.08, damp_mould: 0.02, cold_heat: 0.01, fire_electrical: 0.005, falls_structural: 0.005 }, "general_repair"),
    hidden_hazard: noulAns(0.06, 0.94),
    vulnerable: noulAns(0.02, 0.98),
    severity: scoreAns(0.3, [0.8, 0.15, 0.04, 0.01]),
  },
  // 16: fence panel blew down -> routine
  {
    emergency_danger: noulAns(0.03, 0.97),
    essential_service: noulAns(0.01, 0.99),
    category: choiceAns({ general_repair: 0.92, falls_structural: 0.05, damp_mould: 0.01, cold_heat: 0.005, fire_electrical: 0.005, hygiene_pests: 0.01 }, "general_repair"),
    hidden_hazard: noulAns(0.08, 0.92),
    vulnerable: noulAns(0.02, 0.98),
    severity: scoreAns(0.4, [0.75, 0.2, 0.04, 0.01]),
  },
  // 17: flat is horrible pls help nobody listens -> vague / triage_officer
  {
    emergency_danger: noulAns(0.22, 0.78),
    essential_service: noulAns(0.18, 0.82),
    category: choiceAns({ general_repair: 0.25, damp_mould: 0.2, cold_heat: 0.15, falls_structural: 0.15, hygiene_pests: 0.15, fire_electrical: 0.1 }, "general_repair", 0.25),
    hidden_hazard: noulAns(0.35, 0.65),
    vulnerable: noulAns(0.2, 0.8),
    severity: scoreAns(1.5, [0.25, 0.35, 0.25, 0.15]),
  },
  // 18: Polish damp complaint -> translation / human
  {
    emergency_danger: noulAns(0.1, 0.9),
    essential_service: noulAns(0.05, 0.95),
    category: choiceAns({ damp_mould: 0.6, general_repair: 0.2, hygiene_pests: 0.1, cold_heat: 0.05, falls_structural: 0.03, fire_electrical: 0.02 }, "damp_mould", 0.4),
    hidden_hazard: noulAns(0.7, 0.7),
    vulnerable: noulAns(0.1, 0.9),
    severity: scoreAns(2.0, [0.1, 0.3, 0.4, 0.2]),
  },
  // 19: smoke alarm keeps beeping, took battery out -> significant fire_electrical
  {
    emergency_danger: noulAns(0.22, 0.78),
    essential_service: noulAns(0.03, 0.97),
    category: choiceAns({ fire_electrical: 0.92, general_repair: 0.04, falls_structural: 0.01, cold_heat: 0.01, damp_mould: 0.01, hygiene_pests: 0.01 }, "fire_electrical"),
    hidden_hazard: noulAns(0.85, 0.85),
    vulnerable: noulAns(0.1, 0.9),
    severity: scoreAns(2.2, [0.05, 0.3, 0.5, 0.15]),
  },
];

const questionsMap = Object.fromEntries(
  dNodes.map(({ id, node }) => [id, questionKey(node.question)])
);

const out = {
  model: "laya-typed-decisions",
  source: "convaiinnovations/laya-typed-decisions",
  variant: "q8e8",
  backend: "wasm",
  createdAt: new Date().toISOString(),
  workflows: {
    "awaab-triage": wf.examples.map((ex, i) => ({
      text: ex.text,
      questions: questionsMap,
      answers: exampleAnswers[i],
    })),
  },
};

fs.writeFileSync(
  new URL("../web/recorded.json", import.meta.url),
  JSON.stringify(out, null, 1) + "\n"
);
console.log("web/recorded.json generated with 20 examples for awaab-triage.");
