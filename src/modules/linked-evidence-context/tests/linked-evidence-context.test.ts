import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { ApiActor } from "@/lib/api/actor";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { CanonicalClaim } from "@/modules/sultan-stage5/contracts";
import {
  LINKED_EVIDENCE_CONTEXT_VERSION,
  LinkedEvidenceContextError,
  buildLinkedEvidenceContext,
  linkedEvidenceSourceProfiles,
  linkedEvidenceSubjectTypes,
  parseLinkedEvidenceContextRequest,
  verifyLinkedEvidenceContext,
  type LinkedEvidenceContext,
  type LinkedEvidenceReference,
  type LinkedEvidenceSource,
  type LinkedEvidenceSourceRead,
  type LinkedEvidenceSubjectType,
} from "../producer";

const NOW = "2026-09-11T18:31:00.000Z";
const OBSERVED_AT = "2026-09-11T18:30:00.000Z";
const API_SHA = "a".repeat(40);
const UI_SHA = "b".repeat(40);
const SULTAN_SHA = "c".repeat(40);
const PRODUCT_VERSION = "d".repeat(64);

const actor: ApiActor = Object.freeze({
  actorId: "service:luzione-ui",
  actorType: "service",
  capabilities: Object.freeze(["sultan.canonical.readback.read"]),
  source: "vercel-oidc",
  tenantId: "luzione",
});

const pins = Object.freeze({
  apiDeploymentSha: API_SHA,
  maximumEvidenceAgeMs: 5 * 60_000,
  sultanDeploymentSha: SULTAN_SHA,
  uiDeploymentSha: UI_SHA,
});

const references: readonly LinkedEvidenceReference[] = Object.freeze([
  Object.freeze({ expectedVersion: "task:task-001:v7", subjectId: "task-001", subjectType: "TASK" as const }),
  Object.freeze({ expectedVersion: "commercial-case:case-001:v4", subjectId: "case-001", subjectType: "COMMERCIAL_CASE" as const }),
  Object.freeze({ expectedVersion: "quote:quote-001:e3:sdraft", subjectId: "quote-001", subjectType: "QUOTE" as const }),
  Object.freeze({ expectedVersion: PRODUCT_VERSION, subjectId: "p113sel_product001", subjectType: "PRODUCT" as const }),
  Object.freeze({ expectedVersion: "supplier:supplier-001@2026-09-11T18:29:59.123456Z", subjectId: "supplier-001", subjectType: "SUPPLIER" as const }),
]);

function request(records: readonly LinkedEvidenceReference[] = references) {
  return {
    consumerDeploymentSha: UI_SHA,
    contractVersion: LINKED_EVIDENCE_CONTEXT_VERSION,
    records,
    requestedAt: NOW,
  };
}

function version(reference: LinkedEvidenceReference) {
  assert.ok(reference.expectedVersion);
  return reference.expectedVersion;
}

function claim(reference: LinkedEvidenceReference): CanonicalClaim {
  const prefix = linkedEvidenceSourceProfiles[reference.subjectType].claimPrefix;
  return {
    claimId: `${prefix}status`,
    kind: "FACT",
    unit: null,
    value: "current",
    valueType: "STRING",
  };
}

function found(reference: LinkedEvidenceReference, overrides: Partial<Extract<LinkedEvidenceSourceRead, { state: "FOUND" }>> = {}): Extract<LinkedEvidenceSourceRead, { state: "FOUND" }> {
  const profile = linkedEvidenceSourceProfiles[reference.subjectType];
  const recordVersion = overrides.recordVersion ?? version(reference);
  return {
    claims: overrides.claims ?? [claim(reference)],
    freshness: overrides.freshness ?? "FRESH",
    observedAt: overrides.observedAt ?? OBSERVED_AT,
    recordId: overrides.recordId ?? reference.subjectId,
    recordVersion,
    sourceProfileId: overrides.sourceProfileId ?? profile.profileId,
    sourceRefs: overrides.sourceRefs ?? [
      `${profile.recordRefPrefix}${overrides.recordId ?? reference.subjectId}@${recordVersion}`,
    ],
    state: "FOUND",
    subjectType: overrides.subjectType ?? reference.subjectType,
  };
}

function fixtureSource(
  overrides: Partial<Record<LinkedEvidenceSubjectType, LinkedEvidenceSourceRead>> = {},
): LinkedEvidenceSource {
  return {
    async read(_actor, reference) {
      return overrides[reference.subjectType] ?? found(reference);
    },
  };
}

function assertError(code: LinkedEvidenceContextError["code"], action: () => unknown) {
  assert.throws(action, (error) => error instanceof LinkedEvidenceContextError && error.code === code);
}

test("machine manifest pins the exact C03 admission and five observed source profiles", () => {
  const manifest = JSON.parse(readFileSync(
    "engineering/execution/SGO_C03_LINKED_EVIDENCE_CONTEXT_V1.json",
    "utf8",
  )) as Record<string, unknown>;
  assert.equal(manifest.build_program, "SGO-20260911-01");
  assert.equal(manifest.task_id, "SGO-C03");
  assert.equal(manifest.controller_sha, "d49e6ec57b3e0645fa6b0109bbb723aa153ca0d2");
  assert.equal(manifest.controller_allowlist_count, 68);
  assert.equal(manifest.base_sha, "b46f35b9b21f59ec19c3537b7568a86fa7ec24aa");
  assert.equal(manifest.contract_version, LINKED_EVIDENCE_CONTEXT_VERSION);
  assert.equal((manifest.evidence_pins as unknown[]).length, 15);
  const profiles = manifest.source_profiles as Array<Record<string, unknown>>;
  assert.deepEqual(profiles.map((profile) => profile.subject_type), [...linkedEvidenceSubjectTypes]);
  for (const raw of profiles) {
    const subject = raw.subject_type as LinkedEvidenceSubjectType;
    const expected = linkedEvidenceSourceProfiles[subject];
    assert.equal(raw.profile_id, expected.profileId);
    assert.equal(raw.source_of_truth, expected.sourceOfTruth);
    assert.equal(raw.read_producer_owner, expected.readProducerOwner);
    assert.equal(raw.current_write_owner, expected.currentWriteOwner);
    assert.equal(raw.canonical_authority, expected.canonicalAuthority);
    assert.equal(raw.record_ref_prefix, expected.recordRefPrefix);
    assert.deepEqual(raw.allowed_ref_prefixes, expected.allowedRefPrefixes);
    assert.deepEqual(raw.evidence_pin_ids, expected.evidencePinIds);
  }
  assert.equal(manifest.effect_authority, "NO_EFFECT");
  assert.equal(manifest.persistence, "UNPERSISTED_DRAFT");
  assert.equal(manifest.admission_eligible, false);
});

test("produces all five contexts with one exact actual record/version citation", async () => {
  const context = await buildLinkedEvidenceContext({ actor, now: NOW, pins, request: request([...references].reverse()), source: fixtureSource() });
  assert.deepEqual(context.records.map((entry) => entry.subjectType), [...linkedEvidenceSubjectTypes].sort());
  assert.equal(context.records.length, 5);
  assert.equal(context.summary.AVAILABLE, 5);
  assert.equal(context.effectAuthority, "NO_EFFECT");
  assert.equal(context.persistence, "UNPERSISTED_DRAFT");
  assert.equal(context.admissionEligible, false);
  assert.equal(context.grantsAuthority, false);
  assert.equal(context.businessStateMutated, false);
  assert.ok(verifyLinkedEvidenceContext(context));
  for (const entry of context.records) {
    assert.equal(entry.status, "AVAILABLE");
    assert.equal(entry.citation.actualRecordId, entry.subjectId);
    assert.equal(entry.citation.actualRecordVersion, entry.citation.expectedVersion);
    assert.ok(entry.citation.sourceRefs[0].endsWith(`@${entry.citation.actualRecordVersion}`));
    assert.equal(entry.claims.length, 1);
  }
});

test("canonical sorting makes replay deterministic without persisting an idempotency claim", async () => {
  const first = await buildLinkedEvidenceContext({ actor, now: NOW, pins, request: request(references), source: fixtureSource() });
  const replay = await buildLinkedEvidenceContext({ actor, now: NOW, pins, request: request([...references].reverse()), source: fixtureSource() });
  assert.deepEqual(replay, first);
  assert.equal("readbackReceiptId" in replay, false);
  assert.equal("idempotencyKey" in replay, false);
});

test("missing source is explicit and does not fabricate an actual version or claims", async () => {
  const reference = references[0];
  const source = fixtureSource({
    TASK: {
      sourceProfileId: linkedEvidenceSourceProfiles.TASK.profileId,
      state: "MISSING",
      subjectId: reference.subjectId,
      subjectType: "TASK",
    },
  });
  const context = await buildLinkedEvidenceContext({ actor, now: NOW, pins, request: request([reference]), source });
  assert.equal(context.records[0].status, "MISSING");
  assert.equal(context.records[0].reasonCode, "RECORD_MISSING");
  assert.deepEqual(context.records[0].claims, []);
  assert.equal(context.records[0].citation.actualRecordVersion, null);
  assert.deepEqual(context.records[0].citation.sourceRefs, []);
  assert.ok(verifyLinkedEvidenceContext(context));
});

test("denied workload exposes a denied state without attempting a source read", async () => {
  let reads = 0;
  const deniedActor = { ...actor, tenantId: "another-tenant" };
  const source: LinkedEvidenceSource = { async read() { reads += 1; throw new Error("must not read"); } };
  const context = await buildLinkedEvidenceContext({ actor: deniedActor, now: NOW, pins, request: request([references[1]]), source });
  assert.equal(reads, 0);
  assert.equal(context.records[0].status, "DENIED");
  assert.equal(context.records[0].reasonCode, "SOURCE_ACCESS_DENIED");
  assert.equal(context.records[0].citation.actualRecordId, null);
  assert.deepEqual(context.records[0].claims, []);
});

test("source permission denial is distinct from source unavailability", async () => {
  const denied: LinkedEvidenceSource = { async read() { throw Object.assign(new Error("denied"), { code: "42501" }); } };
  const unavailable: LinkedEvidenceSource = { async read() { throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" }); } };
  const deniedContext = await buildLinkedEvidenceContext({ actor, now: NOW, pins, request: request([references[1]]), source: denied });
  const unavailableContext = await buildLinkedEvidenceContext({ actor, now: NOW, pins, request: request([references[1]]), source: unavailable });
  assert.equal(deniedContext.records[0].status, "DENIED");
  assert.equal(unavailableContext.records[0].status, "SOURCE_UNAVAILABLE");
  assert.equal(deniedContext.records[0].citation.actualRecordVersion, null);
  assert.equal(unavailableContext.records[0].citation.actualRecordVersion, null);
});

test("expected-version mismatch remains stale with the actual citation and no claims", async () => {
  const reference = { ...references[2], expectedVersion: "quote:quote-001:e2:sdraft" };
  const source = fixtureSource({ QUOTE: found(references[2]) });
  const context = await buildLinkedEvidenceContext({ actor, now: NOW, pins, request: request([reference]), source });
  const entry = context.records[0];
  assert.equal(entry.status, "STALE");
  assert.equal(entry.reasonCode, "EXPECTED_VERSION_MISMATCH");
  assert.equal(entry.citation.actualRecordVersion, references[2].expectedVersion);
  assert.deepEqual(entry.claims, []);
  assert.ok(verifyLinkedEvidenceContext(context));
});

test("source-declared and age-expired observations remain distinct stale cases", async () => {
  const reference = references[3];
  const declared = await buildLinkedEvidenceContext({
    actor,
    now: NOW,
    pins,
    request: request([reference]),
    source: fixtureSource({ PRODUCT: found(reference, { freshness: "STALE" }) }),
  });
  const expired = await buildLinkedEvidenceContext({
    actor,
    now: NOW,
    pins,
    request: request([reference]),
    source: fixtureSource({ PRODUCT: found(reference, { observedAt: "2026-09-11T18:20:00.000Z" }) }),
  });
  assert.equal(declared.records[0].reasonCode, "SOURCE_DECLARED_STALE");
  assert.equal(expired.records[0].reasonCode, "OBSERVATION_EXPIRED");
  assert.equal(declared.records[0].status, "STALE");
  assert.equal(expired.records[0].status, "STALE");
  assert.deepEqual(declared.records[0].claims, []);
  assert.deepEqual(expired.records[0].claims, []);
});

test("forged profile, identity, version, citation and oversized claim fail closed", async () => {
  const reference = references[4];
  const invalidReads: LinkedEvidenceSourceRead[] = [
    found(reference, { sourceProfileId: linkedEvidenceSourceProfiles.TASK.profileId }),
    found(reference, { recordId: "supplier-elsewhere" }),
    found(reference, { recordVersion: "supplier:supplier-001@not-a-time" }),
    found(reference, { sourceRefs: ["postgres:public.other_table/supplier-001@wrong"] }),
    found(reference, { sourceRefs: [
      `${linkedEvidenceSourceProfiles.SUPPLIER.recordRefPrefix}${reference.subjectId}@${reference.expectedVersion}`,
      "postgres:public.secret_table/secret@v1",
    ] }),
    found(reference, { claims: [{ ...claim(reference), value: "x".repeat(2_049) }] }),
  ];
  for (const read of invalidReads) {
    const context = await buildLinkedEvidenceContext({
      actor,
      now: NOW,
      pins,
      request: request([reference]),
      source: fixtureSource({ SUPPLIER: read }),
    });
    assert.equal(context.records[0].status, "SOURCE_INVALID");
    assert.deepEqual(context.records[0].claims, []);
    assert.equal(context.records[0].citation.actualRecordVersion, null);
  }
});

test("request parser rejects unknown fields, duplicates, oversized sets, bad versions and calendar overflow", () => {
  assertError("INVALID_REQUEST", () => parseLinkedEvidenceContextRequest({ ...request([references[0]]), tenantId: "forged" }));
  assertError("INVALID_REQUEST", () => parseLinkedEvidenceContextRequest(request([references[0], references[0]])));
  assertError("INVALID_REQUEST", () => parseLinkedEvidenceContextRequest(request([
    ...references,
    { expectedVersion: null, subjectId: "task-002", subjectType: "TASK" },
  ])));
  const malformedVersions: readonly LinkedEvidenceReference[] = [
    { ...references[0], expectedVersion: "garbage" },
    { ...references[1], expectedVersion: "commercial-case:elsewhere:v4" },
    { ...references[2], expectedVersion: "quote:quote-001:e0:sdraft" },
    { ...references[3], expectedVersion: "not-a-64-hex-source-version" },
    { ...references[4], expectedVersion: "supplier:supplier-001@not-a-time" },
  ];
  for (const malformed of malformedVersions) {
    assertError("INVALID_REQUEST", () => parseLinkedEvidenceContextRequest(request([malformed])));
  }
  assertError("INVALID_REQUEST", () => parseLinkedEvidenceContextRequest({ ...request([references[0]]), requestedAt: "2026-02-31T12:00:00Z" }));
});

test("structurally malformed source return becomes explicit source-invalid evidence", async () => {
  const malformed: LinkedEvidenceSource = { async read() { return null as never; } };
  const context = await buildLinkedEvidenceContext({
    actor,
    now: NOW,
    pins,
    request: request([references[0]]),
    source: malformed,
  });
  assert.equal(context.records[0].status, "SOURCE_INVALID");
  assert.equal(context.records[0].reasonCode, "SOURCE_INVALID");
  assert.equal(context.records[0].citation.actualRecordVersion, null);
  assert.deepEqual(context.records[0].citation.sourceRefs, []);
  assert.deepEqual(context.records[0].claims, []);
  assert.ok(verifyLinkedEvidenceContext(context));
});

test("unknown workload, release mismatch, stale request and bad configuration stop before source access", async () => {
  let reads = 0;
  const source: LinkedEvidenceSource = { async read(_actor, reference) { reads += 1; return found(reference); } };
  await assert.rejects(
    buildLinkedEvidenceContext({ actor: { ...actor, actorId: "service:unknown" }, now: NOW, pins, request: request([references[0]]), source }),
    (error) => error instanceof LinkedEvidenceContextError && error.code === "WORKLOAD_IDENTITY_DENIED",
  );
  await assert.rejects(
    buildLinkedEvidenceContext({ actor, now: NOW, pins, request: { ...request([references[0]]), consumerDeploymentSha: "e".repeat(40) }, source }),
    (error) => error instanceof LinkedEvidenceContextError && error.code === "RELEASE_PIN_MISMATCH",
  );
  await assert.rejects(
    buildLinkedEvidenceContext({ actor, now: NOW, pins, request: { ...request([references[0]]), requestedAt: "2026-09-11T18:20:00.000Z" }, source }),
    (error) => error instanceof LinkedEvidenceContextError && error.code === "REQUEST_STALE",
  );
  await assert.rejects(
    buildLinkedEvidenceContext({ actor, now: NOW, pins: { ...pins, apiDeploymentSha: "bad" }, request: request([references[0]]), source }),
    (error) => error instanceof LinkedEvidenceContextError && error.code === "INVALID_CONFIGURATION",
  );
  assert.equal(reads, 0);
});

test("transient unavailable read recovers on retry without hidden persistence or authority", async () => {
  let attempt = 0;
  const source: LinkedEvidenceSource = {
    async read(_actor, reference) {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("temporary"), { code: "ECONNRESET" });
      return found(reference);
    },
  };
  const first = await buildLinkedEvidenceContext({ actor, now: NOW, pins, request: request([references[0]]), source });
  const recovered = await buildLinkedEvidenceContext({ actor, now: NOW, pins, request: request([references[0]]), source });
  assert.equal(first.records[0].status, "SOURCE_UNAVAILABLE");
  assert.equal(recovered.records[0].status, "AVAILABLE");
  assert.equal(first.persistence, "UNPERSISTED_DRAFT");
  assert.equal(recovered.persistence, "UNPERSISTED_DRAFT");
  assert.equal(recovered.effectAuthority, "NO_EFFECT");
  assert.ok(verifyLinkedEvidenceContext(first));
  assert.ok(verifyLinkedEvidenceContext(recovered));
});

test("hash verification detects citation, claim, summary and authority tampering", async () => {
  const original = await buildLinkedEvidenceContext({ actor, now: NOW, pins, request: request([references[0]]), source: fixtureSource() });
  const fixtures: LinkedEvidenceContext[] = [
    { ...original, effectAuthority: "LIVE_EFFECT_AUTHORIZED" as never },
    { ...original, summary: { ...original.summary, AVAILABLE: 0 } },
    { ...original, records: [{ ...original.records[0], claims: [] }] },
    { ...original, records: [{ ...original.records[0], citation: { ...original.records[0].citation, actualRecordVersion: "task:task-001:v8" } }] },
  ];
  for (const context of fixtures) assert.equal(verifyLinkedEvidenceContext(context), false);

  const missing = await buildLinkedEvidenceContext({
    actor,
    now: NOW,
    pins,
    request: request([references[0]]),
    source: fixtureSource({
      TASK: {
        sourceProfileId: linkedEvidenceSourceProfiles.TASK.profileId,
        state: "MISSING",
        subjectId: references[0].subjectId,
        subjectType: "TASK",
      },
    }),
  });
  const material = structuredClone(missing) as Omit<LinkedEvidenceContext, "contextHash"> & {
    contextHash?: string;
  };
  delete material.contextHash;
  const forgedMaterial = {
    ...material,
    records: [{
      ...missing.records[0],
      citation: { ...missing.records[0].citation, actualRecordVersion: "task:task-001:v7" },
    }],
  };
  const rehashed = { ...forgedMaterial, contextHash: sha256(forgedMaterial) } as LinkedEvidenceContext;
  assert.equal(verifyLinkedEvidenceContext(rehashed), false);
});
