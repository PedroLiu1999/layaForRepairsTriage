// Repairs triage workflow shaped around Awaab's Law and social housing repairs in England.
// All decision questions are answered by the in-browser Laya model or read from recorded answers.

export const WORKFLOWS = [
  {
    id: "awaab-triage",
    name: "Repairs triage (Awaab's Law)",
    domain: "Social housing repairs",
    entity: "RepairReport",
    description: "Screen a tenant's repair report for emergencies, classify the hazard, flag vulnerability and book the right inspection. Fails closed: anything unclear goes to a person.",
    input: {},
    start: "emergency_danger",
    safety: {
      autoOutcomes: ["routine_outcome"],
      mustPassFalse: ["emergency_danger", "essential_service"], // every auto path must take the "false" edge through these
      mustPassOneOfFalse: [["hidden_hazard"]], // and through at least one of these groups
      lowConfidenceMustBeHuman: true, // every onLowConfidence target leads only to human outcomes
      forbiddenDispositions: ["block"]
    },
    nodes: {
      emergency_danger: {
        type: "decision",
        label: "Immediate danger?",
        question: {
          type: "noul",
          instructions: "The report describes an immediate danger to someone's health or safety in the home"
        },
        cutoff: 0.3,
        routes: { true: "make_safe_24h", false: "essential_service" },
        onLowConfidence: "urgent_review"
      },
      essential_service: {
        type: "decision",
        label: "Essential service lost?",
        question: {
          type: "noul",
          instructions: "The home has no heating, no hot water, no water supply or no electricity"
        },
        cutoff: 0.3,
        routes: { true: "make_safe_24h", false: "category" },
        onLowConfidence: "urgent_review"
      },
      category: {
        type: "decision",
        label: "Hazard type",
        question: {
          type: "choice",
          instructions: "What is the main problem in the home?",
          criteria: {
            damp_mould: "Damp, mould or condensation",
            cold_heat: "Home too cold or too hot, heating or insulation",
            fire_electrical: "Fire risk or electrical fault",
            falls_structural: "Trip, fall or structural risk such as stairs, floors, ceilings or walls",
            hygiene_pests: "Drains, toilets, pests, rubbish or kitchen hygiene",
            general_repair: "Other repair"
          }
        },
        routes: {
          damp_mould: "vulnerable",
          cold_heat: "vulnerable",
          fire_electrical: "vulnerable",
          falls_structural: "vulnerable",
          hygiene_pests: "vulnerable",
          general_repair: "hidden_hazard"
        },
        onLowConfidence: "triage_officer"
      },
      hidden_hazard: {
        type: "decision",
        label: "Could it harm health?",
        question: {
          type: "noul",
          instructions: "This problem could harm someone's health or safety if it is not fixed"
        },
        cutoff: 0.35,
        routes: { true: "vulnerable", false: "routine_repair" },
        onLowConfidence: "triage_officer"
      },
      vulnerable: {
        type: "decision",
        label: "Vulnerable occupant?",
        question: {
          type: "noul",
          instructions: "Someone in the home is especially vulnerable, such as a baby, young child, pregnant person, older person, or someone with a health condition or disability"
        },
        cutoff: 0.35,
        routes: { true: "flag_vulnerable", false: "severity" },
        onLowConfidence: "flag_vulnerable"
      },
      flag_vulnerable: {
        type: "task",
        channel: "audit",
        label: "Flag vulnerable household",
        template: "Vulnerability flagged for this case; raise priority.",
        next: "severity"
      },
      severity: {
        type: "decision",
        label: "Health impact",
        question: {
          type: "score",
          instructions: "How serious is the risk to the health of the people living there?",
          criteria: ["Minor", "Moderate", "Serious", "Severe"]
        },
        routes: { "0-1": "book_inspection", "2+": "book_inspection_priority" },
        onLowConfidence: "book_inspection_priority"
      },
      book_inspection: {
        type: "task",
        channel: "ticket",
        label: "Book competent-person inspection",
        template: "Book inspection ({{answers.category.selected}}).",
        next: "ack_tenant"
      },
      book_inspection_priority: {
        type: "task",
        channel: "ticket",
        label: "Book PRIORITY inspection",
        template: "Book priority inspection ({{answers.category.selected}}, severity {{answers.severity.label}}).",
        next: "ack_tenant"
      },
      ack_tenant: {
        type: "task",
        channel: "sms",
        label: "Acknowledge to tenant",
        template: "Thank you, we have logged your report and will contact you to arrange an inspection.",
        next: "inspection_outcome"
      },
      make_safe_24h: {
        type: "task",
        channel: "page",
        label: "Dispatch emergency make-safe",
        template: "EMERGENCY report: {{input.text}}",
        next: "emergency_outcome"
      },
      routine_repair: {
        type: "task",
        channel: "ticket",
        label: "Raise routine repair job",
        template: "Routine repair: {{input.text}}",
        next: "routine_outcome"
      },
      urgent_review: {
        type: "outcome",
        disposition: "human",
        label: "Urgent human review (possible emergency)"
      },
      triage_officer: {
        type: "outcome",
        disposition: "human",
        label: "Triage officer decides"
      },
      emergency_outcome: {
        type: "outcome",
        disposition: "human",
        label: "Emergency: dispatcher confirms make-safe"
      },
      inspection_outcome: {
        type: "outcome",
        disposition: "human",
        label: "Inspection booked, clock running"
      },
      routine_outcome: {
        type: "outcome",
        disposition: "auto",
        label: "Routine repair raised automatically"
      }
    },
    examples: [
      { text: "There's a strong smell of gas in the kitchen and it's getting worse, I've opened the windows." },
      { text: "The socket behind the fridge sparked and now there's a burning smell." },
      { text: "Our boiler stopped working yesterday, no heating or hot water, and my mum is 84." },
      { text: "Water is pouring through the bathroom ceiling into the light fitting." },
      { text: "Front door lock snapped, I can't lock the flat tonight." },
      { text: "Black mould is spreading on the wall behind my baby's cot and she keeps coughing." },
      { text: "Bit of condensation on the bedroom windows most mornings, some black spots on the seal." },
      { text: "The whole bedroom smells musty, wallpaper peeling, mould on the ceiling. I have asthma." },
      { text: "The flat is freezing even with the heating on full, the windows don't close properly." },
      { text: "Top-floor flat gets unbearably hot in summer, we can't sleep." },
      { text: "The banister on the stairs is loose and wobbles when you lean on it." },
      { text: "There's a big crack in the living-room wall that has got wider this month." },
      { text: "We've seen rats in the kitchen and droppings in the cupboards." },
      { text: "The only toilet is blocked and won't flush." },
      { text: "The kitchen cupboard door hinge has come loose." },
      { text: "Dripping tap in the bathroom sink, not urgent." },
      { text: "A fence panel in the garden blew down in the wind." },
      { text: "flat is horrible pls help nobody listens" },
      { text: "Z powodu cieknącej rury na ścianie w sypialni pojawił się grzyb i pleśń, śmierdzi stęchlizną." },
      { text: "The smoke alarm keeps beeping and I took the battery out." }
    ]
  }
];
