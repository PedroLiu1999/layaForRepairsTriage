import test from "node:test";
import assert from "node:assert/strict";
import { createCase, reduceCase, appendEvent, canCloseCase } from "../web/cases.js";

test("createCase initializes case with received and triaged events", () => {
  const c = createCase({
    id: "CASE-001",
    text: "Mould on the bedroom wall.",
    receivedAt: "2026-06-01T10:00:00.000Z",
    track: "significant",
    category: "damp_mould",
    vulnerable: true,
  });

  assert.equal(c.id, "CASE-001");
  assert.equal(c.events.length, 2);
  assert.equal(c.events[0].type, "received");
  assert.equal(c.events[1].type, "triaged");

  const state = reduceCase(c);
  assert.equal(state.track, "significant");
  assert.equal(state.category, "damp_mould");
  assert.equal(state.vulnerable, true);
  assert.equal(state.status, "open");
  assert.equal(state.isSafe, false);
});

test("appendEvent records overrides and updates current state without mutating prior events", () => {
  const c = createCase({
    id: "CASE-002",
    text: "Cupboard hinge loose",
    track: "routine",
    category: "general_repair",
  });

  const updated = appendEvent(c, {
    actor: "officer:Jane",
    type: "track_override",
    data: { from: "routine", track: "significant", reason: "Tenant mentioned cracked lintel during call" },
  });

  assert.equal(updated.events.length, 3);
  assert.equal(c.events.length, 2, "Original case events must not be mutated");

  const state = reduceCase(updated);
  assert.equal(state.track, "significant");
  assert.equal(state.overrides.length, 1);
  assert.equal(state.overrides[0].reason, "Tenant mentioned cracked lintel during call");
});

test("closing rules: non-officer actor cannot close a case", () => {
  const c = createCase({
    text: "Dripping tap",
    track: "routine",
  });

  assert.equal(canCloseCase(reduceCase(c), "model").allowed, false);
  assert.equal(canCloseCase(reduceCase(c), "system").allowed, false);
  assert.equal(canCloseCase(reduceCase(c), "tenant").allowed, false);
  assert.equal(canCloseCase(reduceCase(c), "officer:Smith").allowed, true);
});

test("closing rules: routine track can be closed by officer directly", () => {
  const c = createCase({
    text: "Dripping tap",
    track: "routine",
  });

  const closed = appendEvent(c, {
    actor: "officer:Smith",
    type: "closed",
    data: { reason: "Routine washer replaced." },
  });

  const state = reduceCase(closed);
  assert.equal(state.status, "closed");
  assert.equal(state.closedBy, "officer:Smith");
});

test("closing rules: significant case cannot be closed without recorded inspection with finding", () => {
  const c = createCase({
    text: "Mould in bedroom",
    track: "significant",
    category: "damp_mould",
  });

  // Attempt to close before inspection
  assert.throws(
    () => {
      appendEvent(c, {
        actor: "officer:Smith",
        type: "closed",
      });
    },
    /Cannot close case/
  );

  // Record an inspection
  const inspected = appendEvent(c, {
    actor: "officer:Smith",
    type: "inspection_recorded",
    data: {
      date: "2026-06-05T14:00:00.000Z",
      competentPerson: "John Surveyor (HHSRS cert)",
      finding: "significant",
    },
  });

  // Now it can be closed by officer
  const closed = appendEvent(inspected, {
    actor: "officer:Smith",
    type: "closed",
    data: { notes: "Remediation complete." },
  });

  const state = reduceCase(closed);
  assert.equal(state.status, "closed");
  assert.equal(state.inspectionFinding, "significant");
});
