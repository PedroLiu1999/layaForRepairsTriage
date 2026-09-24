// Awaab's Law statutory timescale rules for social housing repairs in England.
// Nothing timing-related may be hardcoded outside of this file.
// Sourced from GOV.UK guidance and statutory regulations.

export const JURISDICTION = {
  country: "England",
  regulations: "The Hazards in Social Housing (Prescribed Requirements) (England) Regulations 2025 (as amended)",
  guidanceUrl: "https://www.gov.uk/government/collections/awaabs-law-in-the-social-rented-sector",
};

export const RULES = [
  {
    id: "emergency_investigate_make_safe",
    description: "Investigate and make safe an emergency hazard within 24 hours",
    amount: 24,
    unit: "hours",
    from: "report_received",
    appliesTo: ["emergency"],
    source: "https://www.gov.uk/government/publications/awaabs-law-guidance-for-social-landlords",
    verified: true,
    notes: "Emergency hazards: landlord must investigate and make safe within 24 hours of becoming aware of the hazard.",
  },
  {
    id: "significant_investigate",
    description: "Investigate a potential significant hazard within 10 working days",
    amount: 10,
    unit: "workingDays",
    from: "report_received",
    appliesTo: ["significant"],
    source: "https://www.gov.uk/government/publications/awaabs-law-guidance-for-social-landlords",
    verified: true,
    notes: "Investigation timescale: landlord must conclude investigation within 10 working days of becoming aware.",
  },
  {
    id: "written_summary",
    description: "Give the tenant a written summary of findings and next steps within 3 working days",
    amount: 3,
    unit: "workingDays",
    from: "investigation_concluded",
    appliesTo: ["significant", "emergency"],
    source: "https://www.gov.uk/government/publications/awaabs-law-guidance-for-social-landlords",
    verified: true,
    notes: "Written summary: landlord must provide written findings and planned next steps within 3 working days of concluding investigation.",
  },
  {
    id: "significant_make_safe",
    description: "Make safe a confirmed significant hazard within 5 working days",
    amount: 5,
    unit: "workingDays",
    from: "investigation_concluded",
    appliesTo: ["significant"],
    source: "https://www.gov.uk/government/publications/awaabs-law-guidance-for-social-landlords",
    verified: true,
    notes: "Timescales for repair: landlord must begin works to rectify or make safe within 5 working days of concluding investigation.",
  },
  {
    id: "supplementary_works",
    description: "Begin further works within a reasonable time (taking steps to start within 12 weeks)",
    amount: 12,
    unit: "weeks",
    from: "investigation_concluded",
    appliesTo: ["significant"],
    source: "https://www.gov.uk/government/publications/awaabs-law-phase-2-guidance-for-social-housing-landlords",
    verified: false,
    notes: "Draft guidance and consultations discuss 12-week timeframe for comprehensive supplementary remediation; pending final 2026 enactment.",
  },
  {
    id: "alternative_accommodation",
    description: "Offer suitable alternative accommodation at the landlord's cost if the home cannot be made safe in time",
    amount: 0,
    unit: "hours",
    from: "make_safe_at_risk",
    appliesTo: ["emergency", "significant"],
    source: "https://www.gov.uk/government/publications/awaabs-law-guidance-for-social-landlords",
    verified: true,
    notes: "Alternative accommodation must be offered at landlord expense when hazard cannot be made safe within statutory deadlines.",
  },
];

export const PHASES = [
  {
    id: "phase1",
    name: "Phase 1",
    from: "2025-10-27",
    significantCategories: ["damp_mould"],
    emergency: "all",
    description: "Damp and mould hazards; all emergency hazards.",
  },
  {
    id: "phase2",
    name: "Phase 2",
    from: "2026-11-30",
    significantCategories: ["damp_mould", "cold_heat", "fire_electrical", "falls_structural", "hygiene_pests"],
    emergency: "all",
    description: "All initial prescribed HHSRS hazards including excess cold/heat, fire/electrical, structural/falls, hygiene.",
  },
  {
    id: "phase3",
    name: "Phase 3",
    from: null, // 2027, date TBC
    significantCategories: "all_hhsrs_except_overcrowding",
    emergency: "all",
    description: "All 29 HHSRS hazards except overcrowding.",
  },
];

/**
 * Documented day-counting and out-of-hours convention.
 * Marked verified: false as statutory instrument allows minor variations in landlord service definitions.
 * Conservative default counts receipt day as Day 1 if received during working hours (<= 17:00), giving earlier deadline.
 */
export const DAY_COUNTING_CONVENTION = {
  countReceiptDayIfBeforeCutoff: true,
  workingDayCutoffHour: 17, // 17:00 London time
  verified: false,
  notes: "Conservative reading: reports before 17:00 on a working day count that day as Day 1. Reports after 17:00 or on weekends/holidays begin Day 1 on the following working day.",
};
