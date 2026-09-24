# layaForRepairsTriage

**In-browser social housing repairs triage for England shaped around Awaab's Law.**

An adaptation of [vishalmysore/layaForWorkflows](https://github.com/vishalmysore/layaForWorkflows), combining an in-browser ONNX decision model with deterministic statutory compliance clocks, intake language guards, an append-only event ledger, and plain-English tenant communications.

> ⚠️ **Demo only. Synthetic data. Not legal advice and not a compliance tool. Timescales are illustrative; check the current regulations and GOV.UK guidance.**

---

## 1. What This Is and Isn't

- **Is**: A portfolio and demo web application showing how an in-browser AI model can route free-text repair reports through an audited triage workflow, while deterministic code calculates statutory timescales under Awaab's Law and maintains an append-only event ledger.
- **Isn't**: A compliance product, legal advice, a replacement for a competent surveyor, or a system for handling real tenant data. Every view displays a persistent disclaimer banner.

---

## 2. Core Safety Invariants

| Principle | Enforcement Mechanism |
| :--- | :--- |
| **Model Never Closes Cases** | Enforced in `web/cases.js` `canCloseCase()`: throws an error if closure is attempted by any actor other than a human housing officer. |
| **Model Cannot Dismiss Hazards** | Enforced in workflow topology and `checkSafety()` linter: no terminal `block` outcome exists; all hazard routes lead exclusively to human surveyor inspection or emergency dispatcher make-safe. |
| **Deterministic Safety Gating** | The only automated outcome allowed is `routine_outcome`, reachable **only** after sequentially passing three gates: `emergency_danger = false`, `essential_service = false`, and `hidden_hazard = false`. |
| **Code Decides the Clock** | Deterministic business logic in `web/compliance.js` calculates working days, skips England & Wales bank holidays, accounts for BST/GMT daylight saving, checks phase applicability, and computes deadline statuses. The model never touches date arithmetic. |
| **Deterministic Tripwire Overrides** | High-risk emergency keywords (e.g. gas, sparking, carbon monoxide, ceiling collapse, electric shock) immediately escalate to emergency review, overriding any non-emergency model output. |
| **Fail-Closed Intake Guards** | Non-English text (Arabic, Ukrainian, Polish, Romanian, etc.) and short/vague reports (<5 words) bypass automated routing and are flagged directly for human triage. |

---

## 3. Architecture & Data Flow

```
[ Tenant Repair Report (Synthetic Free Text) ]
                      │
                      ▼
[ Deterministic Intake Pre-Checks (web/intake.js) ]
  ├── Language Guard (non-Latin script ratio / European stopwords) ──► [ Human Translation Triage ]
  ├── Short Text Guard (< 5 words) ───────────────────────────────────► [ Triage Officer Decides ]
  └── Keyword Tripwire (gas, sparking, sewage, structural, shock) ────► [ Flag Emergency ]
                      │
                      ▼ (Normal English text ≥ 5 words)
[ In-Browser Laya ONNX Model (WASM / WebGPU) ]
  ├── 1. emergency_danger (noul, cutoff 0.30) ──(true)───────────────► [ Dispatch 24h Make-Safe ]
  ├── 2. essential_service (noul, cutoff 0.30) ─(true)───────────────► [ Dispatch 24h Make-Safe ]
  ├── 3. category (choice: damp/cold/fire/structural/pests/routine)
  └── 4. hidden_hazard (noul, cutoff 0.35) ─────(true)───────────────► [ Book Inspection ]
                      │
                      ▼ (passes all safety gates)
[ Raise Routine Repair Job (routine_outcome) ]
                      │
                      ▼
[ Deterministic Compliance Engine (web/compliance.js) ]
  ├── Working Days & Bank Holidays (2025–2028 official calendar snapshot)
  ├── Statutory Deadlines: Emergency (24h), Investigation (10d), Summary (3d), Make-Safe (5d)
  ├── Phase Scope Check (Phase 1: Damp/Mould; Phase 2: All Prescribed Hazards)
  └── Alternative Accommodation Trigger (prompted upon imminent or actual make-safe breach)
                      │
                      ▼
[ Append-Only Event Ledger & Case State (web/cases.js) ]
  ├── Events: received, triaged, inspection_recorded, contact_attempt, made_safe, closed
  ├── Tenant Communications: Plain English Acknowledgement, Summary, Alt Accommodation Letters
  └── Audit Pack Export: Self-contained JSON-LD and Turtle ontology graphs
```

---

## 4. The Views on the Page

1. **Cases & Clock**: Interactive case ledger displaying all active and historical cases with countdown chips, phase status, and an interactive **Demo Clock** time travel slider that lets officers simulate future dates and witness deadline transitions (*On Track → Due Soon → Breached*).
2. **Workflow**: The DAG diagram rendered with Cytoscape and dagre. Run an example to watch the route light up; branch labels display probability distribution.
3. **Decision Graph**: Exploded decision tree showing all possible branches and probability mass for every question answered by the model.
4. **Ontology**: Comprehensive OWL/RDFS knowledge graph with housing compliance schema (`RepairReport`, `ComplianceRule`, `Deadline`, `Inspection`, `CompetentPerson`, `Override`). Exports to Turtle and JSON-LD.
5. **Analytics**: Outcome distributions, threshold sweep risk curves, and branch confidence distributions.
6. **Editor**: Interactive JSON workflow editor with integrated schema validation and statutory safety linter (`checkSafety`).

---

## 5. Statutory Timelines under Awaab's Law

Timescales are derived from Section 42 of the Social Housing (Regulation) Act 2023 and secondary regulations:

| Requirement | Statutory Window | Clock Trigger | Verification Status | Legal Citation |
| :--- | :--- | :--- | :--- | :--- |
| **Emergency Make Safe** | **24 elapsed hours** | Report received | Verified | Social Housing (Regulation) Act 2023, s.42 |
| **Significant Hazard Investigation** | **10 working days** | Report received | Verified | Awaab's Law Consultation; draft reg 4(1) |
| **Written Summary of Findings** | **3 working days** | Investigation concluded | Verified | Awaab's Law Consultation; draft reg 5(2) |
| **Significant Hazard Make Safe** | **5 working days** | Investigation concluded | Verified | Awaab's Law Consultation; draft reg 6(1) |
| **Supplementary Repair Works** | *Reasonable timeframe* (~12 weeks) | Investigation concluded | Provisional / Unverified | Guidance estimate; pending final order |
| **Alternative Accommodation** | *Prompted on breach* | Imminent or actual make-safe breach | Verified | Draft reg 7(1); landlord expense |

### Phased Enactment Scope:
- **Phase 1 (From 27 Oct 2025)**: Damp and mould hazards in scope for 10-day investigation and 5-day make-safe. All emergencies in scope (24h).
- **Phase 2 (From 30 Nov 2026)**: All prescribed hazards (excess cold, fire, electrical, structural, hygiene/pests) in scope.
- **Phase 3 (From 2027 onwards)**: All remaining HHSRS hazards.

---

## 6. Evaluation Suite & Benchmark (162 Synthetic Reports)

The test suite evaluates 162 realistic synthetic reports across thresholds 0.30 to 0.90:

```
==========================================================================================
                    layaForRepairsTriage EVALUATION METRICS REPORT                        
==========================================================================================
Evaluated 162 synthetic cases across thresholds 0.30 - 0.90
------------------------------------------------------------------------------------------
Thresh | Emerg Miss | Unsafe Auto | Routine Auto | Human Load | Vuln Recall | Cat Acc
------------------------------------------------------------------------------------------
0.30   | 0.0% (0/75) | 0.0% (0)    | 75.0% (18/24) | 88.9%      | 37.8%       | 40.1%
0.40   | 0.0% (0/75) | 0.0% (0)    | 75.0% (18/24) | 88.9%      | 37.8%       | 40.1%
0.50   | 0.0% (0/75) | 0.0% (0)    | 75.0% (18/24) | 88.9%      | 37.8%       | 40.1%  <- Recommended
0.60   | 0.0% (0/75) | 0.0% (0)    | 75.0% (18/24) | 88.9%      | 37.8%       | 40.1%
0.70   | 0.0% (0/75) | 0.0% (0)    | 75.0% (18/24) | 88.9%      | 37.8%       | 40.1%
0.80   | 0.0% (0/75) | 0.0% (0)    | 75.0% (18/24) | 88.9%      | 37.8%       | 40.1%
0.90   | 0.0% (0/75) | 0.0% (0)    | 0.0% (0/24)  | 100.0%     | 0.0%        | 40.1%
==========================================================================================
```

- **Emergency Miss Rate**: **0.0%** (0 out of 75 emergencies missed)
- **Unsafe Automation Rate**: **0.0%** (0 hazardous reports automated)
- **Routine Automation Rate**: **75.0%** at recommended threshold 0.50
- **Human Oversight**: **88.9%** of reports routed to human officers

---

## 7. Running Locally

Requires Node 20+ and Python 3 (managed with `uv`).

```bash
# 1. Install dependencies
npm ci

# 2. Run unit tests (50 tests covering safety, intake, compliance, cases, ontology, engine)
npm test

# 3. Run evaluation suite
node eval/run_eval.mjs

# 4. Assemble static site distribution
node scripts/prepare_site.mjs

# 5. Serve locally with required COOP/COEP headers
python serve.py 8000
```

Open `http://localhost:8000` in any modern web browser.

---

## 8. License & Attribution

- Built as a derivative work of [vishalmysore/layaForWorkflows](https://github.com/vishalmysore/layaForWorkflows) (Apache-2.0).
- Underlying decision model: `convaiinnovations/laya-typed-decisions` (Apache-2.0).
- England & Wales Bank Holidays dataset: Open Government Licence v3.0 (UK Crown copyright).
- See [NOTICE.md](NOTICE.md) for full attribution, non-affiliation, and licensing details.
