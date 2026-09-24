// Draft tenant letters generated from case data and statutory deadlines.
// All letters are labelled "DRAFT, for officer review".
// Plain English, dates in words ("by Tuesday 13 October 2026"), naming the exact next step.

import { toLondonDateString } from "./compliance.js";

/**
 * Format date in plain English words, e.g. "Tuesday 13 October 2026".
 *
 * @param {Date|string|number} date
 * @returns {string}
 */
export function formatDateWords(date) {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * Generate Tenant Repair Report Acknowledgement Letter.
 *
 * @param {object} caseObj - Case object
 * @param {Array} deadlines - Computed deadlines
 * @returns {string}
 */
export function generateAcknowledgementLetter(caseObj, deadlines = []) {
  const recvWords = formatDateWords(caseObj.receivedAt);
  const track = caseObj.track;

  let nextStepText = "";
  if (track === "emergency") {
    const emDl = deadlines.find((d) => d.ruleId === "emergency_investigate_make_safe");
    const dueWords = emDl?.dueAt ? formatDateWords(emDl.dueAt) : "within 24 hours";
    nextStepText = `Because your report indicates an immediate hazard or loss of an essential service, we have dispatched an emergency contractor to inspect and make the problem safe by ${dueWords}. A housing officer will contact you shortly to confirm access.`;
  } else if (track === "significant") {
    const invDl = deadlines.find((d) => d.ruleId === "significant_investigate");
    const dueWords = invDl?.dueAt ? formatDateWords(invDl.dueAt) : "within 10 working days";
    nextStepText = `We have assessed your report regarding ${caseObj.category?.replace("_", " ") || "reported repairs"}. Under our repair standards and statutory timescales, a competent surveyor will carry out a full inspection of your home by ${dueWords}. We will contact you within 2 working days to book a convenient appointment.`;
  } else if (track === "routine") {
    nextStepText = `Thank you for reporting this issue. A routine repair ticket has been raised. Our maintenance team will schedule an operative to visit within our standard routine repair timescales (typically within 20 working days).`;
  } else {
    nextStepText = `A housing triage officer is personally reviewing your report to ensure the appropriate contractor or specialist surveyor is assigned. We will contact you today with further details.`;
  }

  return `[DRAFT, FOR OFFICER REVIEW]

Reference: ${caseObj.id}
Date: ${recvWords}

Dear Resident,

Thank you for contacting us regarding repairs at your home. We received your report on ${recvWords}:

"${caseObj.text}"

${nextStepText}

If you or anyone in your household has specific medical conditions, vulnerabilities, or access requirements, please let us know immediately so we can prioritize and tailor our visit.

Yours sincerely,

Housing Services Maintenance Team
`;
}

/**
 * Generate Written Summary of Investigation Findings Letter.
 * Sent after an inspection is recorded.
 *
 * @param {object} caseObj - Case object
 * @param {Array} deadlines - Computed deadlines
 * @returns {string}
 */
export function generateSummaryLetter(caseObj, deadlines = []) {
  const inspDateWords = formatDateWords(caseObj.inspectionDate || caseObj.receivedAt);
  const msDl = deadlines.find((d) => d.ruleId === "significant_make_safe");
  const makeSafeDue = msDl?.dueAt ? formatDateWords(msDl.dueAt) : "within 5 working days";
  const worksDl = deadlines.find((d) => d.ruleId === "supplementary_works");
  const worksDue = worksDl?.dueAt ? formatDateWords(worksDl.dueAt) : "within reasonable timescales";

  const findingDesc =
    caseObj.inspectionFinding === "significant"
      ? "a significant hazard requiring remedial action under statutory requirements"
      : caseObj.inspectionFinding === "emergency"
      ? "an emergency hazard requiring immediate rectification"
      : caseObj.inspectionFinding === "not_significant"
      ? "no significant statutory hazard, but maintenance works have been logged"
      : "further access required to complete the assessment";

  return `[DRAFT, FOR OFFICER REVIEW]

Reference: ${caseObj.id}
Date: ${formatDateWords(new Date())}

Dear Resident,

Written Summary of Investigation Findings: ${caseObj.category?.replace("_", " ") || "Repairs"}

Following the inspection of your property carried out on ${inspDateWords} by ${caseObj.competentPerson || "our competent surveyor"}, we are writing to provide a written summary of the findings and our schedule of works.

Summary of Findings:
Our surveyor identified ${findingDesc}.

Next Steps & Schedule of Works:
1. Make-Safe / Initial Remediation: Works to remove or make safe the hazard are scheduled to commence by ${makeSafeDue}.
2. Comprehensive Works: Where supplementary repairs are required, preparatory steps and permanent works are scheduled by ${worksDue}.
3. Progress Updates: A dedicated repairs officer will oversee this work and contact you at each stage.

If you have any questions or if you feel the problem has deteriorated, please contact us immediately quoting reference ${caseObj.id}.

Yours sincerely,

Housing Surveyor Team
`;
}

/**
 * Generate Alternative Accommodation Offer Letter.
 * Triggered when a hazard cannot be made safe within statutory timescales.
 *
 * @param {object} caseObj - Case object
 * @returns {string}
 */
export function generateAlternativeAccommodationLetter(caseObj) {
  return `[DRAFT, FOR OFFICER REVIEW]

URGENT: Offer of Suitable Alternative Accommodation
Reference: ${caseObj.id}
Date: ${formatDateWords(new Date())}

Dear Resident,

We are writing to you regarding the urgent repair work underway at your property.

Because we are unable to complete the necessary make-safe works within our statutory timescales, we are formally offering you and your household suitable alternative accommodation at our expense, in accordance with Awaab's Law regulations.

Key terms of this offer:
- Accommodation: We will provide fully furnished, suitable alternative accommodation tailored to your household's requirements.
- Cost: The accommodation will be funded entirely by us at no additional rent or cost to you.
- Storage & Transport: We will arrange and fund transport and secure storage for your belongings where necessary.
- Return: You will retain your tenancy and return to your home as soon as our surveyor certifies that the hazard has been fully made safe.

A housing manager will contact you by telephone within 2 hours to discuss the details and ensure the accommodation meets all your household's needs.

Yours sincerely,

Director of Housing Management
`;
}
