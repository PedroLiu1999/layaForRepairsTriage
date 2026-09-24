import test from "node:test";
import assert from "node:assert/strict";
import { buildOntology, buildCaseOntology, toTurtle, toJsonLd } from "../web/ontology.js";
import { WORKFLOWS } from "../web/workflows.js";
import { createCase, appendEvent } from "../web/cases.js";

test("TBox schema includes housing repairs and compliance classes", () => {
  const onto = buildOntology(WORKFLOWS);
  const classIds = onto.classes.map((c) => c.id);

  const expectedHousingClasses = [
    "RepairReport",
    "HazardCategory",
    "ComplianceRule",
    "Deadline",
    "Inspection",
    "CompetentPerson",
    "ContactAttempt",
    "Override",
    "AlternativeAccommodationOffer",
  ];

  for (const exp of expectedHousingClasses) {
    assert.ok(classIds.includes(exp), `Expected class ${exp} in ontology`);
  }

  const propIds = onto.objectProps.map((p) => p.id);
  const expectedProps = ["hasDeadline", "governedBy", "inspectedBy", "overrides", "offeredTo"];
  for (const exp of expectedProps) {
    assert.ok(propIds.includes(exp), `Expected object property ${exp} in ontology`);
  }
});

test("buildCaseOntology produces valid graph for a case with deadlines and inspections", () => {
  const now = new Date();
  let c = createCase({
    id: "IRT-TEST-ONT-001",
    text: "Mould on ceiling in baby nursery room.",
    receivedAt: now.toISOString(),
    track: "significant",
    category: "damp_mould",
    vulnerable: true,
  });

  c = appendEvent(c, {
    actor: "officer:david_vance",
    type: "inspection_recorded",
    at: now.toISOString(),
    data: {
      date: now.toISOString(),
      competentPerson: "David Vance (Senior Surveyor)",
      finding: "significant",
    },
  });

  c = appendEvent(c, {
    actor: "officer:allocator",
    type: "contact_attempt",
    at: now.toISOString(),
    data: { channel: "phone", outcome: "spoke_with_tenant" },
  });

  const caseOnto = buildCaseOntology(c);

  assert.ok(caseOnto.individuals.size > 0, "Expected individuals in case ontology");
  assert.ok(caseOnto.links.length > 0, "Expected links in case ontology");

  // Check report individual
  const reportInd = [...caseOnto.individuals.values()].find((i) => i.types.includes("RepairReport"));
  assert.ok(reportInd, "Expected RepairReport individual");
  assert.equal(reportInd.data.caseId, "IRT-TEST-ONT-001");
  assert.equal(reportInd.data.vulnerableHousehold, true);
  assert.equal(reportInd.data.track, "significant");

  // Check deadline individuals
  const deadlineInds = [...caseOnto.individuals.values()].filter((i) => i.types.includes("Deadline"));
  assert.ok(deadlineInds.length >= 3, "Expected at least 3 statutory deadlines for significant track");

  // Check inspection individual
  const inspectionInd = [...caseOnto.individuals.values()].find((i) => i.types.includes("Inspection"));
  assert.ok(inspectionInd, "Expected Inspection individual");
  assert.equal(inspectionInd.data.finding, "significant");

  // Check competent person individual
  const personInd = [...caseOnto.individuals.values()].find((i) => i.types.includes("CompetentPerson"));
  assert.ok(personInd, "Expected CompetentPerson individual");
  assert.ok(personInd.data.label.includes("David Vance"));

  // Check hasDeadline links
  const deadlineLinks = caseOnto.links.filter((l) => l.p === "hasDeadline");
  assert.ok(deadlineLinks.length >= 3, "Expected hasDeadline links from case to deadlines");
});

test("toTurtle serializes case audit pack ontology to valid Turtle format", () => {
  const c = createCase({
    id: "IRT-TURTLE-001",
    text: "Gas leak near boiler.",
    track: "emergency",
    category: "fire_electrical",
    vulnerable: false,
  });

  const caseOnto = buildCaseOntology(c);
  const ttl = toTurtle(caseOnto);

  assert.ok(ttl.includes("@prefix lw:"), "Turtle output must include prefix lw:");
  assert.ok(ttl.includes("@prefix owl:"), "Turtle output must include prefix owl:");
  assert.ok(ttl.includes("lw:RepairReport"), "Turtle output must include RepairReport class");
  assert.ok(ttl.includes("report_IRT-TURTLE-001"), "Turtle output must include report individual");
  assert.ok(ttl.includes("lw:hasDeadline"), "Turtle output must include hasDeadline property");
});

test("toJsonLd serializes case audit pack ontology to valid JSON-LD graph", () => {
  const c = createCase({
    id: "IRT-JSONLD-001",
    text: "Cold radiator in bedroom.",
    track: "routine",
    category: "general_repair",
    vulnerable: false,
  });

  const caseOnto = buildCaseOntology(c);
  const jsonld = toJsonLd(caseOnto);

  assert.ok(jsonld["@context"], "JSON-LD output must have @context");
  assert.ok(Array.isArray(jsonld["@graph"]), "JSON-LD output must have @graph array");

  const reportNode = jsonld["@graph"].find((n) => n["@type"]?.includes("lw:RepairReport"));
  assert.ok(reportNode, "Expected lw:RepairReport in @graph");
  assert.equal(reportNode["lw:caseId"], "IRT-JSONLD-001");
});
