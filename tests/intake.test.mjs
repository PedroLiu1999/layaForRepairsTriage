import test from "node:test";
import assert from "node:assert/strict";
import { preCheck, postCheck, EMERGENCY_KEYWORDS } from "../web/intake.js";

test("preCheck passes normal English reports of 5 or more words", () => {
  const text = "Black mould is spreading on the bedroom wall behind the wardrobe.";
  const res = preCheck(text);
  assert.equal(res.proceed, true);
  assert.equal(res.flags.languageGuard, false);
  assert.equal(res.flags.shortText, false);
  assert.equal(res.flags.tripwire, false);
  assert.equal(res.flags.wordCount, 11);
});

test("preCheck catches non-Latin scripts (Cyrillic, Arabic, Chinese) and requests translation", () => {
  // Ukrainian / Russian Cyrillic
  const cyrillic = "У моїй квартирі на стіні з'явилася чорна пліснява, дихати важко.";
  const resCyrillic = preCheck(cyrillic);
  assert.equal(resCyrillic.proceed, false);
  assert.equal(resCyrillic.forcedOutcome, "Needs translation / human triage");
  assert.equal(resCyrillic.flags.languageGuard, true);

  // Arabic
  const arabic = "يوجد تسريب مياه خطير في سقف الحمام يرجى المساعدة فورا";
  const resArabic = preCheck(arabic);
  assert.equal(resArabic.proceed, false);
  assert.equal(resArabic.forcedOutcome, "Needs translation / human triage");
  assert.equal(resArabic.flags.languageGuard, true);
});

test("preCheck catches Latin-script foreign languages (Polish, Romanian)", () => {
  const polish = "Z powodu cieknącej rury na ścianie w sypialni pojawił się grzyb i pleśń, śmierdzi stęchlizną.";
  const res = preCheck(polish);
  assert.equal(res.proceed, false);
  assert.equal(res.forcedOutcome, "Needs translation / human triage");
  assert.equal(res.flags.languageGuard, true);
});

test("preCheck routes text with fewer than 5 words to triage officer", () => {
  const shortTexts = [
    "",
    "   ",
    "help please",
    "boiler broken flat cold",
  ];
  for (const t of shortTexts) {
    const res = preCheck(t);
    assert.equal(res.proceed, false);
    assert.equal(res.forcedOutcome, "Triage officer decides");
    assert.equal(res.flags.shortText, true);
  }
});

test("preCheck flags emergency keyword tripwires", () => {
  const gasReport = "There is a strong smell of gas in our hallway.";
  const resGas = preCheck(gasReport);
  assert.equal(resGas.flags.tripwire, true);
  assert.ok(resGas.flags.tripwireMatches.includes("smell of gas") || resGas.flags.tripwireMatches.includes("gas"));

  const sparksReport = "The kitchen wall outlet had sparks coming out this morning.";
  const resSparks = preCheck(sparksReport);
  assert.equal(resSparks.flags.tripwire, true);
  assert.ok(resSparks.flags.tripwireMatches.includes("sparks"));

  const routineReport = "The kitchen cupboard door hinge came loose and needs tightening.";
  const resRoutine = preCheck(routineReport);
  assert.equal(resRoutine.flags.tripwire, false);
  assert.deepEqual(resRoutine.flags.tripwireMatches, []);
});

test("postCheck escalates if tripwire tripped but model routed to routine or non-emergency outcome", () => {
  const flags = { tripwire: true, tripwireMatches: ["gas"] };
  const routineRun = {
    outcome: { nodeId: "routine_outcome", disposition: "auto" },
    steps: [{ nodeId: "emergency_danger" }, { nodeId: "routine_repair" }],
  };

  const res = postCheck(routineRun, flags);
  assert.equal(res.escalate, true);
  assert.equal(res.reason, "keyword tripwire overrode model route");
});

test("postCheck does NOT escalate if model reached make-safe or urgent review", () => {
  const flags = { tripwire: true, tripwireMatches: ["gas"] };

  const emergencyRun = {
    outcome: { nodeId: "emergency_outcome", disposition: "human" },
    steps: [{ nodeId: "emergency_danger" }, { nodeId: "make_safe_24h" }],
  };
  assert.equal(postCheck(emergencyRun, flags).escalate, false);

  const urgentRun = {
    outcome: { nodeId: "urgent_review", disposition: "human" },
    steps: [{ nodeId: "emergency_danger" }],
  };
  assert.equal(postCheck(urgentRun, flags).escalate, false);
});

test("postCheck does NOT escalate if tripwire was not set", () => {
  const flags = { tripwire: false, tripwireMatches: [] };
  const routineRun = {
    outcome: { nodeId: "routine_outcome", disposition: "auto" },
    steps: [{ nodeId: "emergency_danger" }, { nodeId: "routine_repair" }],
  };
  assert.equal(postCheck(routineRun, flags).escalate, false);
});
