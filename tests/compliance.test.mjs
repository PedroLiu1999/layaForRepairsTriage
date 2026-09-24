import test from "node:test";
import assert from "node:assert/strict";
import {
  addWorkingDays,
  isWorkingDay,
  toLondonDateString,
  checkPhaseScope,
  deriveTrack,
  computeDeadlines,
  getDeadlineStatus,
  alternativeAccommodationPrompt,
} from "../web/compliance.js";
import { BANK_HOLIDAY_DATES } from "../web/bankholidays.js";

test("isWorkingDay correctly identifies weekends and bank holidays", () => {
  // 2025-01-01 is New Year's Day (Bank Holiday)
  assert.equal(isWorkingDay("2025-01-01T10:00:00Z"), false, "New Year's Day should not be a working day");
  // 2025-01-02 is Thursday (Normal working day)
  assert.equal(isWorkingDay("2025-01-02T10:00:00Z"), true, "Jan 2 should be a working day");
  // 2025-01-04 is Saturday
  assert.equal(isWorkingDay("2025-01-04T10:00:00Z"), false, "Saturday is not a working day");
  // 2025-01-05 is Sunday
  assert.equal(isWorkingDay("2025-01-05T10:00:00Z"), false, "Sunday is not a working day");
});

test("addWorkingDays over a standard weekend", () => {
  // Thursday 2025-01-09 at 10:00 (London time)
  // Day 1: Thu Jan 9
  // Day 2: Fri Jan 10
  // Sat Jan 11, Sun Jan 12: skipped
  // Day 3: Mon Jan 13
  const due = addWorkingDays("2025-01-09T10:00:00Z", 3);
  assert.equal(toLondonDateString(due), "2025-01-13");
});

test("addWorkingDays over Christmas and New Year bank holidays", () => {
  // Received Wednesday 2025-12-24 at 10:00 London time
  // Day 1: Wed Dec 24
  // Dec 25 (Christmas Day): Bank holiday
  // Dec 26 (Boxing Day): Bank holiday
  // Dec 27-28: Weekend
  // Day 2: Mon Dec 29
  // Day 3: Tue Dec 30
  // Day 4: Wed Dec 31
  // Jan 1 (New Year's Day): Bank holiday
  // Day 5: Fri Jan 2, 2026
  const due5 = addWorkingDays("2025-12-24T10:00:00Z", 5);
  assert.equal(toLondonDateString(due5), "2026-01-02");
});

test("addWorkingDays over Easter bank holidays", () => {
  // In 2025: Good Friday is April 18, Easter Monday is April 21.
  // Report received Thursday 2025-04-17 at 10:00 London time:
  // Day 1: Thu Apr 17
  // Fri Apr 18: Good Friday (skip)
  // Sat Apr 19, Sun Apr 20: Weekend (skip)
  // Mon Apr 21: Easter Monday (skip)
  // Day 2: Tue Apr 22
  const due2 = addWorkingDays("2025-04-17T10:00:00Z", 2);
  assert.equal(toLondonDateString(due2), "2025-04-22");
});

test("report received on a Friday at 17:30 (out of hours) begins counting on Monday", () => {
  // Friday 2025-01-10 at 17:30 London time (after 17:00 cutoff)
  // Friday is NOT counted as Day 1.
  // Sat Jan 11, Sun Jan 12: skipped
  // Day 1: Mon Jan 13
  const due1 = addWorkingDays("2025-01-10T17:30:00Z", 1);
  assert.equal(toLondonDateString(due1), "2025-01-13");

  // Day 2: Tue Jan 14
  const due2 = addWorkingDays("2025-01-10T17:30:00Z", 2);
  assert.equal(toLondonDateString(due2), "2025-01-14");
});

test("report received during a bank holiday begins counting on the next working day", () => {
  // Jan 1, 2026 is New Year's Day bank holiday (Thursday)
  // Received at 12:00 on Jan 1
  // Thursday Jan 1 does not count as Day 1
  // Day 1: Friday Jan 2, 2026
  const due1 = addWorkingDays("2026-01-01T12:00:00Z", 1);
  assert.equal(toLondonDateString(due1), "2026-01-02");
});

test("24-hour emergency deadline spans exactly 24 elapsed hours across BST changes", () => {
  // Autumn clock change: Sunday 2025-10-26 (BST -> GMT)
  const recvAutumn = "2025-10-25T14:00:00.000Z";
  const caseAutumn = {
    receivedAt: recvAutumn,
    track: "emergency",
    category: "fire_electrical",
    events: [],
  };
  const dlAutumn = computeDeadlines(caseAutumn);
  const emAutumn = dlAutumn.find((d) => d.ruleId === "emergency_investigate_make_safe");
  assert.ok(emAutumn);
  const diffMsAutumn = new Date(emAutumn.dueAt).getTime() - new Date(recvAutumn).getTime();
  assert.equal(diffMsAutumn, 24 * 60 * 60 * 1000, "Must be exactly 24 elapsed hours");

  // Spring clock change: Sunday 2025-03-30 (GMT -> BST)
  const recvSpring = "2025-03-29T14:00:00.000Z";
  const caseSpring = {
    receivedAt: recvSpring,
    track: "emergency",
    category: "fire_electrical",
    events: [],
  };
  const dlSpring = computeDeadlines(caseSpring);
  const emSpring = dlSpring.find((d) => d.ruleId === "emergency_investigate_make_safe");
  assert.ok(emSpring);
  const diffMsSpring = new Date(emSpring.dueAt).getTime() - new Date(recvSpring).getTime();
  assert.equal(diffMsSpring, 24 * 60 * 60 * 1000, "Must be exactly 24 elapsed hours");
});

test("Phase 1 vs Phase 2 in-scope decision either side of 30 Nov 2026", () => {
  // Before Nov 30, 2026 (Phase 1):
  // damp_mould is in scope
  const scopeDampP1 = checkPhaseScope("damp_mould", "significant", "2026-10-15T10:00:00Z");
  assert.equal(scopeDampP1.inScope, true);
  assert.equal(scopeDampP1.phaseId, "phase1");

  // cold_heat is NOT yet in scope (Phase 2 pending)
  const scopeColdP1 = checkPhaseScope("cold_heat", "significant", "2026-10-15T10:00:00Z");
  assert.equal(scopeColdP1.inScope, false);
  assert.equal(scopeColdP1.phaseId, "phase2_pending");

  // On or after Nov 30, 2026 (Phase 2):
  // cold_heat IS now in scope
  const scopeColdP2 = checkPhaseScope("cold_heat", "significant", "2026-12-01T10:00:00Z");
  assert.equal(scopeColdP2.inScope, true);
  assert.equal(scopeColdP2.phaseId, "phase2");
});

test("deriveTrack fails closed: manual cases default to the emergency clock", () => {
  // Unclear / translation / triage_officer -> manual
  assert.equal(deriveTrack(null, { languageGuard: true }), "manual");
  assert.equal(deriveTrack({ outcome: { nodeId: "triage_officer" } }, {}), "manual");

  const manualCase = {
    receivedAt: "2026-05-10T10:00:00Z",
    track: "manual",
    category: "general_repair",
    events: [],
  };
  const deadlines = computeDeadlines(manualCase);
  const emergencyRule = deadlines.find((d) => d.ruleId === "emergency_investigate_make_safe");
  assert.ok(emergencyRule, "Manual case must receive the emergency 24h clock");
  assert.equal(emergencyRule.basis, "24 elapsed hours");
});

test("deriveTrack maps outcomes accurately", () => {
  assert.equal(deriveTrack({ outcome: { nodeId: "emergency_outcome" } }, {}), "emergency");
  assert.equal(deriveTrack({ outcome: { nodeId: "urgent_review" } }, {}), "emergency");
  assert.equal(deriveTrack({ outcome: { nodeId: "inspection_outcome" } }, {}), "significant");
  assert.equal(deriveTrack({ outcome: { nodeId: "routine_outcome" } }, {}), "routine");
  assert.equal(deriveTrack(null, { tripwireEscalated: true }), "emergency");
});

test("alternativeAccommodationPrompt triggers when make-safe deadline is due soon or breached", () => {
  const caseObj = {
    receivedAt: "2026-05-10T10:00:00.000Z",
    track: "emergency",
    category: "fire_electrical",
    events: [],
  };

  // Due at 2026-05-11T10:00:00.000Z
  // At receivedAt + 2 hours: on track (22 hours left) -> false
  assert.equal(alternativeAccommodationPrompt(caseObj, "2026-05-10T12:00:00.000Z"), false);

  // At receivedAt + 20 hours: 4 hours left (under 25% of 24h = 6h) -> due_soon -> true
  assert.equal(alternativeAccommodationPrompt(caseObj, "2026-05-11T06:00:00.000Z"), true);

  // At receivedAt + 25 hours: breached -> true
  assert.equal(alternativeAccommodationPrompt(caseObj, "2026-05-11T11:00:00.000Z"), true);

  // If marked safe: prompt disappears -> false
  const safeCase = {
    ...caseObj,
    events: [{ type: "made_safe", at: "2026-05-10T18:00:00.000Z" }],
  };
  assert.equal(alternativeAccommodationPrompt(safeCase, "2026-05-11T11:00:00.000Z"), false);
});
