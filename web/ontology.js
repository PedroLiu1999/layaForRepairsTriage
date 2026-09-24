// A small OWL/RDFS ontology for typed-decision workflows.
//
//   TBox (schema): Workflow, Node ⊒ {DecisionNode, TaskNode, OutcomeNode ⊒ {Automated, HumanReview, Blocked}},
//                  Question ⊒ {Choice, Score, YesNo}, Option, Case ⊒ {one class per workflow entity}, Run, Decision, Effect.
//   ABox (facts):  every workflow, node, question and option as individuals; and every run as a Run that processes
//                  a Case, makes a chain of Decisions (each pointing at the Option it selected, with its confidence),
//                  performs Effects and ends at an OutcomeNode.
//
// So each decision the model makes is a first-class graph node, linked to the schema it instantiates.
// Pure data, no DOM: the page renders it with Cytoscape, and it exports to Turtle and JSON-LD.

import { RULES, PHASES, DAY_COUNTING_CONVENTION } from "./rules/awaab-england.js";
import { BANK_HOLIDAY_DATES } from "./bankholidays.js";
import { reduceCase } from "./cases.js";
import { computeDeadlines, getDeadlineStatus, checkPhaseScope } from "./compliance.js";

export const NS = "https://vishalmysore.github.io/layaForWorkflows/ontology#";

const CLASSES = [
  ["Workflow", null, "An automated process: a DAG of nodes that starts at a trigger."],
  ["Node", null, "A step in a workflow."],
  ["DecisionNode", "Node", "A step where the Laya model answers one typed question and the answer picks the route."],
  ["TaskNode", "Node", "An automation step with a side effect (email, ticket, page, webhook...)."],
  ["OutcomeNode", "Node", "A terminal step with a disposition."],
  ["AutomatedOutcome", "OutcomeNode", "The case was handled end to end without a person."],
  ["HumanReviewOutcome", "OutcomeNode", "A person makes or confirms the decision."],
  ["BlockedOutcome", "OutcomeNode", "The action was stopped."],
  ["Question", null, "A typed question posed to the model."],
  ["ChoiceQuestion", "Question", "Pick one labelled option."],
  ["ScoreQuestion", "Question", "Pick a level on an ordered scale."],
  ["YesNoQuestion", "Question", "Is the statement true?"],
  ["Option", null, "A possible answer to a question; routes to a node."],
  ["Case", null, "The input a workflow run processes."],
  ["Run", null, "One execution of a workflow on a case."],
  ["Decision", null, "The model's answer at one decision node during a run."],
  ["Effect", null, "A side effect performed by a task node during a run."],
  // Housing Repairs & Awaab's Law Compliance TBox
  ["RepairReport", "Case", "A social housing repair report submitted by a resident or housing officer."],
  ["HazardCategory", null, "A prescribed housing hazard category under the Housing Health and Safety Rating System (HHSRS)."],
  ["ComplianceRule", null, "A statutory requirement or regulation under Awaab's Law."],
  ["Deadline", null, "A deterministic statutory deadline with a calculated due timestamp."],
  ["Inspection", null, "An investigation performed by a qualified competent person."],
  ["CompetentPerson", null, "A housing surveyor or qualified person who investigated the hazard."],
  ["ContactAttempt", null, "An attempt made by the landlord to contact the tenant to arrange access."],
  ["Override", null, "A human decision overriding a model-suggested track or category."],
  ["AlternativeAccommodationOffer", null, "An offer of alternative accommodation made when repairs cannot be made safe in time."],
];

const OBJECT_PROPS = [
  ["hasNode", "Workflow", "Node"], ["startsAt", "Workflow", "Node"], ["asks", "DecisionNode", "Question"],
  ["hasOption", "Question", "Option"], ["routesTo", "Option", "Node"], ["escalatesTo", "DecisionNode", "Node"],
  ["next", "TaskNode", "Node"], ["ofWorkflow", "Run", "Workflow"], ["processes", "Run", "Case"],
  ["hasDecision", "Run", "Decision"], ["atNode", "Decision", "DecisionNode"], ["selected", "Decision", "Option"],
  ["followedBy", "Decision", "Decision"], ["performed", "Run", "Effect"], ["effectOf", "Effect", "TaskNode"],
  ["endedAt", "Run", "OutcomeNode"],
  // Housing Object Properties
  ["hasDeadline", "RepairReport", "Deadline"], ["governedBy", "Deadline", "ComplianceRule"],
  ["inspectedBy", "Inspection", "CompetentPerson"], ["overrides", "Override", "Case"],
  ["offeredTo", "AlternativeAccommodationOffer", "RepairReport"], ["relatedToReport", "Inspection", "RepairReport"],
  ["contactFor", "ContactAttempt", "RepairReport"],
];
const DATA_PROPS = [
  ["label", "string"], ["instructions", "string"], ["text", "string"], ["domain", "string"], ["disposition", "string"],
  ["confidence", "decimal"], ["layaConfidence", "decimal"], ["probability", "decimal"], ["cutoff", "decimal"], ["threshold", "decimal"], ["lowConfidence", "boolean"],
  ["channel", "string"], ["at", "dateTime"], ["source", "string"],
  // Housing Data Properties
  ["dueAt", "dateTime"], ["metAt", "dateTime"], ["startedBy", "dateTime"],
  ["finding", "string"], ["overrideReason", "string"], ["inScopeUnderPhase", "string"],
  ["complianceStatus", "string"], ["vulnerableHousehold", "boolean"], ["caseId", "string"],
  ["legalSource", "string"], ["verified", "boolean"], ["amount", "integer"], ["unit", "string"],
  ["track", "string"], ["category", "string"], ["status", "string"],
];

const OUTCOME_CLASS = { auto: "AutomatedOutcome", human: "HumanReviewOutcome", block: "BlockedOutcome" };
const QUESTION_CLASS = { choice: "ChoiceQuestion", score: "ScoreQuestion", noul: "YesNoQuestion" };
const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");

export const iri = {
  wf: (w) => `wf_${safe(w)}`,
  node: (w, n) => `node_${safe(w)}__${safe(n)}`,
  q: (w, n) => `q_${safe(w)}__${safe(n)}`,
  opt: (w, n, o) => `opt_${safe(w)}__${safe(n)}__${safe(o)}`,
  run: (r) => `run_${safe(r)}`,
  kase: (r) => `case_${safe(r)}`,
  dec: (r, n) => `dec_${safe(r)}__${safe(n)}`,
  eff: (r, n) => `eff_${safe(r)}__${safe(n)}`,
  // Housing IRIs
  case: (c) => `report_${safe(c)}`,
  dl: (c, r) => `dl_${safe(c)}__${safe(r)}`,
  rule: (r) => `rule_${safe(r)}`,
  insp: (c, t) => `insp_${safe(c)}__${safe(t)}`,
  person: (p) => `person_${safe(p || "inspector")}`,
  contact: (c, t) => `contact_${safe(c)}__${safe(t)}`,
  ovr: (c, t) => `ovr_${safe(c)}__${safe(t)}`,
};

/** Build { classes, objectProps, dataProps, individuals: Map(id -> {id, types[], data{}, workflowId, runId}), links[] }. */
export function buildOntology(workflows, runs = []) {
  const classes = CLASSES.map(([id, parent, comment]) => ({ id, parent, comment }));
  const entityClasses = new Set();
  for (const wf of workflows) if (wf.entity && !entityClasses.has(wf.entity) && !CLASSES.some((c) => c[0] === wf.entity)) {
    entityClasses.add(wf.entity);
    classes.push({ id: wf.entity, parent: "Case", comment: `A ${wf.domain || ""} case handled by "${wf.name}".`.replace("  ", " ") });
  }
  const individuals = new Map(), links = [];
  const ind = (id, type, data = {}, extra = {}) => {
    const cur = individuals.get(id);
    if (cur) { if (!cur.types.includes(type)) cur.types.push(type); Object.assign(cur.data, data); return id; }
    individuals.set(id, { id, types: [type], data, ...extra }); return id;
  };
  const link = (s, p, o, extra) => links.push({ s, p, o, ...extra });

  for (const wf of workflows) {
    const W = ind(iri.wf(wf.id), "Workflow", { label: wf.name, domain: wf.domain || "" }, { workflowId: wf.id });
    link(W, "startsAt", iri.node(wf.id, wf.start));
    for (const [nid, n] of Object.entries(wf.nodes)) {
      const N = iri.node(wf.id, nid);
      const type = n.type === "decision" ? "DecisionNode" : n.type === "task" ? "TaskNode" : OUTCOME_CLASS[n.disposition] || "OutcomeNode";
      const data = { label: n.label || n.question?.instructions || nid };
      if (n.type === "task") data.channel = n.channel || "task";
      if (n.type === "outcome") data.disposition = n.disposition;
      if (n.cutoff != null) data.cutoff = n.cutoff;
      ind(N, type, data, { workflowId: wf.id, nodeId: nid });
      link(W, "hasNode", N);
      if (n.type === "decision") {
        const Q = ind(iri.q(wf.id, nid), QUESTION_CLASS[n.question.type], { instructions: n.question.instructions, label: n.question.instructions }, { workflowId: wf.id, nodeId: nid });
        link(N, "asks", Q);
        const q = n.question;
        const keys = q.type === "choice" ? (Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria)) : q.type === "score" ? q.criteria.map((_, i) => String(i)) : ["false", "true"];
        for (const k of keys) {
          const label = q.type === "score" ? `${k}: ${q.criteria[+k]}` : q.type === "noul" ? (k === "true" ? "yes" : "no") : k;
          const O = ind(iri.opt(wf.id, nid, k), "Option", { label }, { workflowId: wf.id, nodeId: nid, optionKey: k });
          link(Q, "hasOption", O);
          const target = routeTarget(n, k);
          if (target) link(O, "routesTo", iri.node(wf.id, target));
        }
        if (n.onLowConfidence) link(N, "escalatesTo", iri.node(wf.id, n.onLowConfidence));
      } else if (n.type === "task") link(N, "next", iri.node(wf.id, n.next));
    }
  }

  for (const run of runs) {
    const wf = workflows.find((w) => w.id === run.workflowId);
    if (!wf) continue;
    const R = ind(iri.run(run.id), "Run", { label: `Run ${run.id.slice(-5)}`, at: run.at, source: run.source || "model", threshold: run.threshold }, { workflowId: wf.id, runId: run.id });
    const C = ind(iri.kase(run.id), wf.entity || "Case", { label: shortText(run.input.subject ? `${run.input.subject}: ${run.input.text}` : run.input.text), text: run.input.text }, { workflowId: wf.id, runId: run.id });
    link(R, "ofWorkflow", iri.wf(wf.id)); link(R, "processes", C);
    let prev = null;
    for (const s of run.steps) {
      if (s.kind === "decision") {
        const D = ind(iri.dec(run.id, s.nodeId), "Decision", {
          label: `${s.label}: ${s.selectedLabel}`, confidence: s.confidence, probability: s.probs[s.selected],
          layaConfidence: s.layaConfidence, threshold: s.threshold, lowConfidence: s.lowConfidence,
        }, { workflowId: wf.id, runId: run.id, nodeId: s.nodeId });
        link(R, "hasDecision", D); link(D, "atNode", iri.node(wf.id, s.nodeId));
        link(D, "selected", iri.opt(wf.id, s.nodeId, s.selected), { weight: s.probs[s.selected] });
        if (prev) link(prev, "followedBy", D);
        prev = D;
      } else if (s.kind === "task") {
        const E = ind(iri.eff(run.id, s.nodeId), "Effect", { label: s.effect.text, channel: s.effect.channel, at: s.effect.at }, { workflowId: wf.id, runId: run.id, nodeId: s.nodeId });
        link(R, "performed", E); link(E, "effectOf", iri.node(wf.id, s.nodeId));
      } else if (s.kind === "outcome") link(R, "endedAt", iri.node(wf.id, s.nodeId));
    }
  }
  return { classes, objectProps: OBJECT_PROPS.map(([id, domain, range]) => ({ id, domain, range })), dataProps: DATA_PROPS.map(([id, type]) => ({ id, type })), individuals, links };
}

function routeTarget(node, key) {
  const routes = node.routes || {};
  if (node.question.type !== "score") return routes[key];
  const lvl = +key;
  for (const [rk, to] of Object.entries(routes)) {
    const m = rk.match(/^(\d+)(?:-(\d+)|(\+))?$/);
    if (!m) continue;
    const lo = +m[1], hi = m[3] ? Infinity : m[2] != null ? +m[2] : lo;
    if (lvl >= lo && lvl <= hi) return to;
  }
  return undefined;
}
const shortText = (t) => (t.length > 60 ? t.slice(0, 57) + "…" : t);

// ---- case audit pack ontology -------------------------------------------------------------

/**
 * Build a self-contained OWL/RDF ontology for a single case and its audit pack.
 *
 * @param {object} rawCase - Case object with events
 * @param {Array} [rules=RULES] - Compliance rules
 * @param {Set|Array} [holidays=BANK_HOLIDAY_DATES] - Bank holiday calendar
 * @param {object} [convention=DAY_COUNTING_CONVENTION] - Receipt day convention
 * @returns {object} Ontology structure with classes, objectProps, dataProps, individuals, links
 */
export function buildCaseOntology(rawCase, rules = RULES, holidays = BANK_HOLIDAY_DATES, convention = DAY_COUNTING_CONVENTION) {
  const c = reduceCase(rawCase);
  const deadlines = computeDeadlines(rawCase, rules, holidays, convention);
  const scope = checkPhaseScope(c.category, c.track, c.receivedAt, PHASES);
  const now = new Date();

  const classes = CLASSES.map(([id, parent, comment]) => ({ id, parent, comment }));
  const individuals = new Map(), links = [];
  const ind = (id, type, data = {}, extra = {}) => {
    const cur = individuals.get(id);
    if (cur) { if (!cur.types.includes(type)) cur.types.push(type); Object.assign(cur.data, data); return id; }
    individuals.set(id, { id, types: [type], data, ...extra }); return id;
  };
  const link = (s, p, o, extra) => links.push({ s, p, o, ...extra });

  // 1. Case individual
  const caseIri = iri.case(c.id);
  ind(caseIri, "RepairReport", {
    label: `Repair Report ${c.id}`,
    caseId: c.id,
    text: c.text,
    at: c.receivedAt,
    status: c.status,
    track: c.track,
    category: c.category || "unspecified",
    vulnerableHousehold: c.vulnerable,
    inScopeUnderPhase: scope.phaseId,
  });

  // 2. Rules individuals
  for (const rule of rules) {
    const ruleIri = iri.rule(rule.id);
    ind(ruleIri, "ComplianceRule", {
      label: rule.name || rule.description,
      legalSource: rule.source,
      verified: rule.verified,
      amount: rule.amount,
      unit: rule.unit,
    });
  }

  // 3. Deadline individuals
  for (const dl of deadlines) {
    const dlIri = iri.dl(c.id, dl.ruleId);
    const st = getDeadlineStatus(dl, now);
    ind(dlIri, "Deadline", {
      label: dl.description,
      dueAt: dl.dueAt || undefined,
      metAt: dl.metAt || undefined,
      complianceStatus: st,
      legalSource: dl.source,
      verified: dl.verified,
    });
    link(caseIri, "hasDeadline", dlIri);
    link(dlIri, "governedBy", iri.rule(dl.ruleId));
  }

  // 4. Events as individuals
  for (const ev of c.events) {
    if (ev.type === "inspection_recorded") {
      const inspIri = iri.insp(c.id, ev.at);
      const personIri = iri.person(ev.data?.competentPerson);
      ind(inspIri, "Inspection", {
        label: `Inspection by ${ev.data?.competentPerson || "Competent person"}`,
        at: ev.at,
        finding: ev.data?.finding || "unspecified",
      });
      ind(personIri, "CompetentPerson", {
        label: ev.data?.competentPerson || "Competent person",
      });
      link(inspIri, "inspectedBy", personIri);
      link(inspIri, "relatedToReport", caseIri);
    } else if (ev.type === "contact_attempt") {
      const contactIri = iri.contact(c.id, ev.at);
      ind(contactIri, "ContactAttempt", {
        label: `Contact via ${ev.data?.channel || "phone"}: ${ev.data?.outcome || "logged"}`,
        at: ev.at,
        channel: ev.data?.channel,
      });
      link(contactIri, "contactFor", caseIri);
    } else if (ev.type === "track_override" || ev.type === "category_override") {
      const ovrIri = iri.ovr(c.id, ev.at);
      ind(ovrIri, "Override", {
        label: `Override: ${ev.data?.from} -> ${ev.data?.track || ev.data?.category}`,
        at: ev.at,
        overrideReason: ev.data?.reason || "Officer discretion",
      });
      link(ovrIri, "overrides", caseIri);
    } else if (ev.type === "alt_accommodation_offered") {
      const altIri = `alt_${safe(c.id)}__${safe(ev.at)}`;
      ind(altIri, "AlternativeAccommodationOffer", {
        label: `Alternative accommodation offered to tenant`,
        at: ev.at,
      });
      link(altIri, "offeredTo", caseIri);
    }
  }

  return {
    classes,
    objectProps: OBJECT_PROPS.map(([id, domain, range]) => ({ id, domain, range })),
    dataProps: DATA_PROPS.map(([id, type]) => ({ id, type })),
    individuals,
    links,
  };
}

// ---- serialisation ----------------------------------------------------------------------

const lit = (v, type) => {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? `"${v}"^^xsd:decimal` : `"${v}"^^xsd:decimal`;
  if (type === "dateTime") return `"${v}"^^xsd:dateTime`;
  return JSON.stringify(String(v));
};

export function toTurtle(onto) {
  const out = [
    `@prefix lw: <${NS}> .`, "@prefix owl: <http://www.w3.org/2002/07/owl#> .", "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .", "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .", "",
    `<${NS.slice(0, -1)}> a owl:Ontology ; rdfs:label "Laya typed-decision workflows" .`, "", "# ---- classes",
  ];
  for (const c of onto.classes) {
    out.push(`lw:${c.id} a owl:Class ; rdfs:comment ${JSON.stringify(c.comment || "")} .`);
    if (c.parent) out.push(`lw:${c.id} rdfs:subClassOf lw:${c.parent} .`);
  }
  out.push("", "# ---- properties");
  for (const p of onto.objectProps) out.push(`lw:${p.id} a owl:ObjectProperty ; rdfs:domain lw:${p.domain} ; rdfs:range lw:${p.range} .`);
  for (const p of onto.dataProps) out.push(`lw:${p.id} a owl:DatatypeProperty ; rdfs:range xsd:${p.type} .`);
  out.push("", "# ---- individuals");
  const dtype = Object.fromEntries(onto.dataProps.map((p) => [p.id, p.type]));
  const bySubject = new Map();
  for (const l of onto.links) (bySubject.get(l.s) || bySubject.set(l.s, []).get(l.s)).push(l);
  for (const i of onto.individuals.values()) {
    const parts = [`lw:${i.id} a ${i.types.map((t) => "lw:" + t).join(", ")}`];
    for (const [k, v] of Object.entries(i.data)) if (v !== undefined && v !== null && v !== "") parts.push(`lw:${k} ${lit(v, dtype[k])}`);
    for (const l of bySubject.get(i.id) || []) parts.push(`lw:${l.p} lw:${l.o}`);
    out.push(parts.join(" ;\n    ") + " .");
  }
  return out.join("\n") + "\n";
}

export function toJsonLd(onto) {
  const graph = [];
  for (const c of onto.classes) graph.push({ "@id": `lw:${c.id}`, "@type": "owl:Class", ...(c.parent ? { "rdfs:subClassOf": { "@id": `lw:${c.parent}` } } : {}), "rdfs:comment": c.comment });
  for (const p of onto.objectProps) graph.push({ "@id": `lw:${p.id}`, "@type": "owl:ObjectProperty", "rdfs:domain": { "@id": `lw:${p.domain}` }, "rdfs:range": { "@id": `lw:${p.range}` } });
  for (const p of onto.dataProps) graph.push({ "@id": `lw:${p.id}`, "@type": "owl:DatatypeProperty", "rdfs:range": { "@id": `xsd:${p.type}` } });
  const bySubject = new Map();
  for (const l of onto.links) (bySubject.get(l.s) || bySubject.set(l.s, []).get(l.s)).push(l);
  for (const i of onto.individuals.values()) {
    const o = { "@id": `lw:${i.id}`, "@type": i.types.map((t) => `lw:${t}`) };
    for (const [k, v] of Object.entries(i.data)) if (v !== undefined && v !== null && v !== "") o[`lw:${k}`] = v;
    for (const l of bySubject.get(i.id) || []) { const k = `lw:${l.p}`; (o[k] ||= []).push({ "@id": `lw:${l.o}` }); }
    graph.push(o);
  }
  return {
    "@context": { lw: NS, owl: "http://www.w3.org/2002/07/owl#", rdfs: "http://www.w3.org/2000/01/rdf-schema#", xsd: "http://www.w3.org/2001/XMLSchema#" },
    "@graph": graph,
  };
}

/** Triples about one individual or class, for the inspector. */
export function describe(onto, id) {
  const c = onto.classes.find((x) => x.id === id);
  if (c) {
    const subs = onto.classes.filter((x) => x.parent === id).map((x) => x.id);
    const count = [...onto.individuals.values()].filter((i) => i.types.includes(id)).length;
    return { kind: "class", id, parent: c.parent, comment: c.comment, subclasses: subs, instances: count,
      props: onto.objectProps.filter((p) => p.domain === id || p.range === id) };
  }
  const i = onto.individuals.get(id);
  if (!i) return null;
  const labelOf = (x) => onto.individuals.get(x)?.data.label || x;
  return {
    kind: "individual", id, types: i.types, data: i.data,
    out: onto.links.filter((l) => l.s === id).map((l) => ({ p: l.p, id: l.o, label: labelOf(l.o) })),
    in: onto.links.filter((l) => l.o === id).map((l) => ({ p: l.p, id: l.s, label: labelOf(l.s) })),
  };
}
