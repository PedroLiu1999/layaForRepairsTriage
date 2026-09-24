// Append-only case management store and event ledger for layaForRepairsTriage.
// Current state is always derived from events. Never mutate earlier events.

const STORAGE_KEY = "irt.cases";

/**
 * Reduce a case and its events into current state.
 *
 * @param {object} rawCase - Case object with events[]
 * @returns {object} Derived current state
 */
export function reduceCase(rawCase) {
  if (!rawCase) return null;

  const derived = {
    id: rawCase.id,
    receivedAt: rawCase.receivedAt,
    text: rawCase.text,
    intake: rawCase.intake || {},
    run: rawCase.run || null,
    track: rawCase.track || "manual",
    category: rawCase.category || null,
    vulnerable: rawCase.vulnerable || false,
    status: "open", // "open" | "closed"
    closedAt: null,
    closedBy: null,
    isSafe: false,
    madeSafeAt: null,
    hasInspection: false,
    inspectionFinding: null, // "emergency" | "significant" | "not_significant" | "no_access"
    inspectionDate: null,
    competentPerson: null,
    summarySent: false,
    summarySentAt: null,
    worksStarted: false,
    worksStartedAt: null,
    altAccommodationOffered: false,
    altAccommodationDeclined: false,
    contactAttempts: [],
    overrides: [],
    events: rawCase.events || [],
  };

  for (const ev of derived.events) {
    switch (ev.type) {
      case "received":
        if (ev.data?.receivedAt) derived.receivedAt = ev.data.receivedAt;
        if (ev.data?.text) derived.text = ev.data.text;
        break;
      case "triaged":
        if (ev.data?.track) derived.track = ev.data.track;
        if (ev.data?.category) derived.category = ev.data.category;
        if (ev.data?.vulnerable !== undefined) derived.vulnerable = ev.data.vulnerable;
        if (ev.data?.run) derived.run = ev.data.run;
        break;
      case "tripwire_escalation":
        derived.track = "emergency";
        break;
      case "track_override":
        if (ev.data?.track) {
          derived.track = ev.data.track;
          derived.overrides.push({ type: "track", from: ev.data.from, to: ev.data.track, reason: ev.data.reason, at: ev.at, actor: ev.actor });
        }
        break;
      case "category_override":
        if (ev.data?.category) {
          derived.category = ev.data.category;
          derived.overrides.push({ type: "category", from: ev.data.from, to: ev.data.category, reason: ev.data.reason, at: ev.at, actor: ev.actor });
        }
        break;
      case "contact_attempt":
        derived.contactAttempts.push({ at: ev.at, channel: ev.data?.channel, outcome: ev.data?.outcome, actor: ev.actor });
        break;
      case "inspection_booked":
        derived.inspectionBooked = true;
        derived.inspectionBookedAt = ev.at;
        break;
      case "inspection_recorded":
        derived.hasInspection = true;
        derived.inspectionDate = ev.data?.date || ev.at;
        derived.competentPerson = ev.data?.competentPerson || "Competent person";
        derived.inspectionFinding = ev.data?.finding || null;
        break;
      case "summary_sent":
        derived.summarySent = true;
        derived.summarySentAt = ev.at;
        break;
      case "made_safe":
        derived.isSafe = true;
        derived.madeSafeAt = ev.at;
        break;
      case "works_started":
        derived.worksStarted = true;
        derived.worksStartedAt = ev.at;
        break;
      case "alt_accommodation_offered":
        derived.altAccommodationOffered = true;
        break;
      case "alt_accommodation_declined":
        derived.altAccommodationDeclined = true;
        break;
      case "closed":
        derived.status = "closed";
        derived.closedAt = ev.at;
        derived.closedBy = ev.actor;
        break;
      default:
        break;
    }
  }

  return derived;
}

/**
 * Validate whether a case may be closed.
 * The one overriding rule: model can never close.
 * Closed may only be written by an officer, and only after inspection_recorded with a finding,
 * or on the routine track.
 *
 * @param {object} caseState - Current reduced case state
 * @param {string} actor - Actor identifier (must start with "officer:")
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canCloseCase(caseState, actor) {
  if (!actor || !String(actor).startsWith("officer:")) {
    return { allowed: false, reason: "Only a housing officer may close a case." };
  }

  if (caseState.status === "closed") {
    return { allowed: false, reason: "Case is already closed." };
  }

  if (caseState.track === "routine") {
    return { allowed: true };
  }

  if (!caseState.hasInspection || !caseState.inspectionFinding) {
    return {
      allowed: false,
      reason: "Non-routine cases require an inspection with finding before they can be closed.",
    };
  }

  return { allowed: true };
}

/**
 * Create a new case object with initial 'received' and 'triaged' events.
 *
 * @param {object} params
 * @param {string} params.text - Tenant report text
 * @param {string} [params.receivedAt] - ISO timestamp of receipt
 * @param {string} params.track - Initial derived track
 * @param {string} [params.category] - Initial category
 * @param {boolean} [params.vulnerable] - Vulnerability flag
 * @param {object} [params.intake] - Intake pre-check result
 * @param {object} [params.run] - Full workflow trace
 * @param {string} [params.actor="model"] - Initial actor
 * @returns {object} The created case
 */
export function createCase({
  id,
  text,
  receivedAt = new Date().toISOString(),
  track = "manual",
  category = null,
  vulnerable = false,
  intake = {},
  run = null,
  actor = "model",
}) {
  const caseId = id || `IRT-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

  const events = [
    {
      at: receivedAt,
      actor: "system",
      type: "received",
      data: { receivedAt, text },
    },
    {
      at: new Date().toISOString(),
      actor,
      type: "triaged",
      data: { track, category, vulnerable, run },
    },
  ];

  if (intake?.tripwireEscalated) {
    events.push({
      at: new Date().toISOString(),
      actor: "system",
      type: "tripwire_escalation",
      data: { reason: "keyword tripwire overrode model route", matches: intake.tripwireMatches },
    });
  }

  const raw = {
    id: caseId,
    receivedAt,
    text,
    intake,
    run,
    track,
    category,
    vulnerable,
    events,
  };

  return raw;
}

/**
 * Append an event to a case. Returns updated raw case.
 *
 * @param {object} rawCase - Raw case object
 * @param {object} event - { at, actor, type, data }
 * @returns {object} Updated raw case
 */
export function appendEvent(rawCase, { actor, type, data, at = new Date().toISOString() }) {
  const current = reduceCase(rawCase);

  if (type === "closed") {
    const check = canCloseCase(current, actor);
    if (!check.allowed) {
      throw new Error(`Cannot close case: ${check.reason}`);
    }
  }

  const updatedEvents = [...rawCase.events, { at, actor, type, data: data || {} }];
  const updatedCase = {
    ...rawCase,
    events: updatedEvents,
  };

  // Re-reduce to keep top-level fields aligned
  const derived = reduceCase(updatedCase);
  updatedCase.track = derived.track;
  updatedCase.category = derived.category;
  updatedCase.vulnerable = derived.vulnerable;

  return updatedCase;
}

/**
 * Load all cases from localStorage.
 * @returns {Array<object>}
 */
export function loadCases() {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Failed to load cases from localStorage:", err);
    return [];
  }
}

/**
 * Save cases list to localStorage.
 * @param {Array<object>} cases
 */
export function saveCases(cases) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  } catch (err) {
    console.error("Failed to save cases to localStorage:", err);
  }
}

/**
 * Clear all demo cases from localStorage.
 */
export function clearCases() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error("Failed to clear cases from localStorage:", err);
  }
}
