// Deterministic compliance layer for Awaab's Law (England).
// Pure functions for working days, statutory deadlines, legal phase scoping and status tracking.
// No timing-related logic is hardcoded; all configuration comes from rules/awaab-england.js.

import { RULES, PHASES, DAY_COUNTING_CONVENTION } from "./rules/awaab-england.js";
import { BANK_HOLIDAY_DATES } from "./bankholidays.js";

/**
 * Format a Date as YYYY-MM-DD in Europe/London timezone.
 */
export function toLondonDateString(date) {
  const d = new Date(date);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year").value;
  const month = parts.find((p) => p.type === "month").value;
  const day = parts.find((p) => p.type === "day").value;
  return `${year}-${month}-${day}`;
}

/**
 * Get Europe/London hour (0-23) for a given Date.
 */
export function getLondonHour(date) {
  const d = new Date(date);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(d);
  return parseInt(parts.find((p) => p.type === "hour").value, 10);
}

/**
 * Check if a date is a working day (Mon-Fri, not a bank holiday) in London.
 */
export function isWorkingDay(date, holidays = BANK_HOLIDAY_DATES) {
  const d = new Date(date);
  // Get day of week in London
  const weekdayStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(d);
  if (weekdayStr === "Sat" || weekdayStr === "Sun") return false;

  const dateStr = toLondonDateString(d);
  if (holidays instanceof Set) {
    if (holidays.has(dateStr)) return false;
  } else if (Array.isArray(holidays)) {
    if (holidays.some((h) => (typeof h === "string" ? h === dateStr : h.date === dateStr))) return false;
  }
  return true;
}

/**
 * Add N working days to a date, skipping weekends and bank holidays.
 * Respects the documented day-counting convention and out-of-hours cutoff.
 * Returns an ISO timestamp in UTC.
 *
 * @param {Date|string|number} startDate - Starting timestamp
 * @param {number} n - Number of working days
 * @param {Set|Array} [holidays] - Bank holiday dates (defaults to BANK_HOLIDAY_DATES)
 * @param {object} [convention] - Day-counting convention
 * @returns {string} ISO UTC timestamp of deadline (set to 17:00 London time on target day)
 */
export function addWorkingDays(startDate, n, holidays = BANK_HOLIDAY_DATES, convention = DAY_COUNTING_CONVENTION) {
  const start = new Date(startDate);
  if (isNaN(start.getTime())) throw new Error("Invalid start date");
  if (n <= 0) return start.toISOString();

  const conv = convention || DAY_COUNTING_CONVENTION;
  const cutoffHour = conv.workingDayCutoffHour ?? 17;
  const countReceiptDay = conv.countReceiptDayIfBeforeCutoff ?? true;

  const startHour = getLondonHour(start);
  const startIsWorkingDay = isWorkingDay(start, holidays);

  let counted = 0;
  // If received on a working day on or before cutoff, conservative reading counts it as Day 1
  if (startIsWorkingDay && startHour < cutoffHour && countReceiptDay) {
    counted = 1;
  }

  // Iterate calendar days until counted == n
  const curr = new Date(start);
  while (counted < n) {
    // Advance by 24 hours
    curr.setUTCDate(curr.getUTCDate() + 1);
    // Standardize to noon UTC to avoid daylight saving boundary drift during date stepping
    curr.setUTCHours(12, 0, 0, 0);
    if (isWorkingDay(curr, holidays)) {
      counted++;
    }
  }

  // The deadline falls on curr date at 17:00 London time
  const targetDateStr = toLondonDateString(curr);
  // Construct 17:00 London time on targetDateStr
  // Using an ISO string with London timezone offset resolution
  const [year, month, day] = targetDateStr.split("-").map(Number);

  // Determine BST vs GMT offset for target day:
  // We can test noon on target day to find Europe/London offset
  const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const utcParts = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "numeric", hourCycle: "h23" }).formatToParts(testDate);
  const londonParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).formatToParts(testDate);
  const utcHour = parseInt(utcParts.find((p) => p.type === "hour").value, 10);
  const lonHour = parseInt(londonParts.find((p) => p.type === "hour").value, 10);
  const offsetHours = (lonHour - utcHour + 24) % 24; // 1 for BST, 0 for GMT

  // 17:00 London is (17 - offsetHours) UTC
  const deadlineUtc = new Date(Date.UTC(year, month - 1, day, 17 - offsetHours, 0, 0, 0));
  return deadlineUtc.toISOString();
}

/**
 * Check if a hazard category is in scope under Awaab's Law phases.
 *
 * @param {string} category - Hazard category
 * @param {string} track - Case track ("emergency" | "significant" | "routine" | "manual")
 * @param {Date|string} receivedAt - Report received date
 * @param {Array} [phases] - Phases definition
 * @returns {{ inScope: boolean, phaseId: string, badgeText: string }}
 */
export function checkPhaseScope(category, track, receivedAt, phases = PHASES) {
  const d = new Date(receivedAt);
  const dateStr = toLondonDateString(d);

  // All emergency hazards are in scope under Phase 1 and Phase 2
  if (track === "emergency" || track === "manual") {
    if (dateStr >= "2025-10-27") {
      return { inScope: true, phaseId: "phase1", badgeText: "In scope (Emergency: 24h)" };
    }
    return { inScope: false, phaseId: "pre_enactment", badgeText: "Pre-enactment (from 27 Oct 2025)" };
  }

  if (track === "routine") {
    return { inScope: false, phaseId: "out_of_scope", badgeText: "Routine repair (outside statutory timescales)" };
  }

  // Significant track scoping:
  if (dateStr >= "2026-11-30") {
    // Phase 2
    const p2Cats = ["damp_mould", "cold_heat", "fire_electrical", "falls_structural", "hygiene_pests"];
    if (p2Cats.includes(category)) {
      return { inScope: true, phaseId: "phase2", badgeText: "In scope (Phase 2)" };
    }
    return { inScope: false, phaseId: "phase3_future", badgeText: "Not yet in scope (Phase 3 from 2027)" };
  } else if (dateStr >= "2025-10-27") {
    // Phase 1: damp and mould only
    if (category === "damp_mould") {
      return { inScope: true, phaseId: "phase1", badgeText: "In scope (Phase 1: Damp & Mould)" };
    }
    return { inScope: false, phaseId: "phase2_pending", badgeText: "Not yet in scope (Phase 2 from 30 Nov 2026)" };
  }

  return { inScope: false, phaseId: "pre_enactment", badgeText: "Pre-enactment (from 27 Oct 2025)" };
}

/**
 * Derive the case track from the model run and intake flags.
 *
 * @param {object} run - Workflow trace
 * @param {object} intakeFlags - Intake flags
 * @returns {"emergency" | "significant" | "routine" | "manual"}
 */
export function deriveTrack(run, intakeFlags) {
  // 1. Keyword tripwire escalation: safety invariant always takes precedence
  if (intakeFlags?.tripwireEscalated || intakeFlags?.tripwire) {
    return "emergency";
  }

  // 2. Language guard or short text forced outcomes
  if (intakeFlags?.languageGuard || intakeFlags?.forcedOutcome === "Needs translation / human triage") {
    return "manual";
  }
  if (intakeFlags?.shortText || intakeFlags?.forcedOutcome === "Triage officer decides") {
    return "manual";
  }

  // 3. Model run outcome
  const outcomeId = run?.outcome?.nodeId;
  if (outcomeId === "emergency_outcome" || outcomeId === "urgent_review") {
    return "emergency";
  }
  if (outcomeId === "inspection_outcome") {
    return "significant";
  }
  if (outcomeId === "routine_outcome") {
    return "routine";
  }
  if (outcomeId === "triage_officer") {
    return "manual";
  }

  // Fail closed: any unrecognized route defaults to manual (which gets the emergency clock)
  return "manual";
}

/**
 * Compute all statutory deadlines for a case.
 *
 * @param {object} caseObj - Case record
 * @param {Array} [rules] - Rules definitions
 * @param {Set|Array} [holidays] - Bank holidays
 * @param {Array} [phases] - Phase definitions
 * @param {object} [convention] - Day-counting convention
 * @returns {Array<object>} Deadlines list
 */
export function computeDeadlines(
  caseObj,
  rules = RULES,
  holidays = BANK_HOLIDAY_DATES,
  phases = PHASES,
  convention = DAY_COUNTING_CONVENTION
) {
  const track = caseObj.track || "manual";
  const receivedAt = new Date(caseObj.receivedAt);
  const events = caseObj.events || [];
  const deadlines = [];

  const inspectionEvent = events.find((e) => e.type === "inspection_recorded");
  const makeSafeEvent = events.find((e) => e.type === "made_safe");
  const summarySentEvent = events.find((e) => e.type === "summary_sent");
  const worksStartedEvent = events.find((e) => e.type === "works_started");

  const scopeInfo = checkPhaseScope(caseObj.category, track, receivedAt, phases);

  // Routine cases have no statutory Awaab timescales
  if (track === "routine") {
    return [];
  }

  for (const rule of rules) {
    // Check applicability
    // Emergency or manual (manual defaults to emergency clock):
    if (track === "emergency" || track === "manual") {
      if (rule.id === "emergency_investigate_make_safe") {
        // 24 elapsed hours from receipt
        const totalWindowMs = 24 * 60 * 60 * 1000;
        const dueAt = new Date(receivedAt.getTime() + totalWindowMs).toISOString();
        deadlines.push({
          ruleId: rule.id,
          description: rule.description,
          dueAt,
          startAt: receivedAt.toISOString(),
          totalWindowMs,
          from: "Report received",
          basis: "24 elapsed hours",
          inScope: true, // Emergency hazards are in scope under all phases
          verified: rule.verified,
          source: rule.source,
          metAt: makeSafeEvent?.at || null,
        });
      }
    }

    // Significant track:
    if (track === "significant") {
      if (rule.id === "significant_investigate") {
        const dueAt = addWorkingDays(receivedAt, rule.amount, holidays, convention);
        const totalWindowMs = new Date(dueAt).getTime() - receivedAt.getTime();
        deadlines.push({
          ruleId: rule.id,
          description: rule.description,
          dueAt,
          startAt: receivedAt.toISOString(),
          totalWindowMs,
          from: "Report received",
          basis: `${rule.amount} working days`,
          inScope: scopeInfo.inScope,
          verified: rule.verified,
          source: rule.source,
          metAt: inspectionEvent?.at || null,
        });
      } else if (rule.id === "written_summary") {
        if (inspectionEvent) {
          const dueAt = addWorkingDays(inspectionEvent.at, rule.amount, holidays, convention);
          const totalWindowMs = new Date(dueAt).getTime() - new Date(inspectionEvent.at).getTime();
          deadlines.push({
            ruleId: rule.id,
            description: rule.description,
            dueAt,
            startAt: inspectionEvent.at,
            totalWindowMs,
            from: "Investigation concluded",
            basis: `${rule.amount} working days`,
            inScope: scopeInfo.inScope,
            verified: rule.verified,
            source: rule.source,
            metAt: summarySentEvent?.at || null,
          });
        } else {
          deadlines.push({
            ruleId: rule.id,
            description: rule.description,
            dueAt: null,
            pending: "Starts when inspection is recorded",
            from: "Investigation concluded",
            basis: `${rule.amount} working days`,
            inScope: scopeInfo.inScope,
            verified: rule.verified,
            source: rule.source,
            metAt: null,
          });
        }
      } else if (rule.id === "significant_make_safe") {
        if (inspectionEvent) {
          const dueAt = addWorkingDays(inspectionEvent.at, rule.amount, holidays, convention);
          const totalWindowMs = new Date(dueAt).getTime() - new Date(inspectionEvent.at).getTime();
          deadlines.push({
            ruleId: rule.id,
            description: rule.description,
            dueAt,
            startAt: inspectionEvent.at,
            totalWindowMs,
            from: "Investigation concluded",
            basis: `${rule.amount} working days`,
            inScope: scopeInfo.inScope,
            verified: rule.verified,
            source: rule.source,
            metAt: makeSafeEvent?.at || null,
          });
        } else {
          deadlines.push({
            ruleId: rule.id,
            description: rule.description,
            dueAt: null,
            pending: "Starts when inspection is recorded",
            from: "Investigation concluded",
            basis: `${rule.amount} working days`,
            inScope: scopeInfo.inScope,
            verified: rule.verified,
            source: rule.source,
            metAt: null,
          });
        }
      } else if (rule.id === "supplementary_works") {
        if (inspectionEvent) {
          // 12 weeks = 60 working days
          const dueAt = addWorkingDays(inspectionEvent.at, rule.amount * 5, holidays, convention);
          const totalWindowMs = new Date(dueAt).getTime() - new Date(inspectionEvent.at).getTime();
          deadlines.push({
            ruleId: rule.id,
            description: rule.description,
            dueAt,
            startAt: inspectionEvent.at,
            totalWindowMs,
            from: "Investigation concluded",
            basis: `${rule.amount} weeks`,
            inScope: scopeInfo.inScope,
            verified: rule.verified,
            source: rule.source,
            metAt: worksStartedEvent?.at || null,
          });
        } else {
          deadlines.push({
            ruleId: rule.id,
            description: rule.description,
            dueAt: null,
            pending: "Starts when inspection is recorded",
            from: "Investigation concluded",
            basis: `${rule.amount} weeks`,
            inScope: scopeInfo.inScope,
            verified: rule.verified,
            source: rule.source,
            metAt: null,
          });
        }
      }
    }
  }

  return deadlines;
}

/**
 * Compute the live compliance status of a single deadline.
 *
 * @param {object} deadline - A deadline object returned by computeDeadlines
 * @param {Date|string|number} now - The current or simulated time
 * @returns {"met" | "pending" | "on_track" | "due_soon" | "breached"}
 */
export function getDeadlineStatus(deadline, now) {
  if (deadline.metAt) return "met";
  if (!deadline.dueAt) return "pending";

  const nowMs = new Date(now).getTime();
  const dueMs = new Date(deadline.dueAt).getTime();

  if (nowMs >= dueMs) return "breached";

  const remainingMs = dueMs - nowMs;
  const totalWindowMs = deadline.totalWindowMs || (deadline.startAt ? dueMs - new Date(deadline.startAt).getTime() : 24 * 3600 * 1000);

  // Under 25% of statutory window, or under 24 hours left (whichever is smaller for <=24h windows, or either for multi-day)
  const isDueSoon = totalWindowMs <= 24 * 60 * 60 * 1000
    ? remainingMs <= totalWindowMs * 0.25
    : (remainingMs <= totalWindowMs * 0.25 || remainingMs <= 24 * 60 * 60 * 1000);

  if (isDueSoon) {
    return "due_soon";
  }

  return "on_track";
}

/**
 * Determine if alternative accommodation prompt should be shown.
 * Returns true when a make-safe deadline is due_soon or breached and the hazard is not made safe.
 *
 * @param {object} caseObj - Case object
 * @param {Date|string|number} now - Current or simulated time
 * @returns {boolean}
 */
export function alternativeAccommodationPrompt(caseObj, now) {
  if (!caseObj) return false;
  const isSafe = caseObj.events?.some((e) => e.type === "made_safe");
  if (isSafe) return false;

  const deadlines = computeDeadlines(caseObj);
  for (const dl of deadlines) {
    if (dl.ruleId === "emergency_investigate_make_safe" || dl.ruleId === "significant_make_safe") {
      const st = getDeadlineStatus(dl, now);
      if (st === "due_soon" || st === "breached") {
        return true;
      }
    }
  }
  return false;
}
