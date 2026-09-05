import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../../../");
const supportRoot = resolve(root, "contracts/support/v1");
const templatePath = resolve(import.meta.dirname, "runtime-template.ts.txt");
const mode = process.argv[2] ?? "--check";

const ref = { $ref: "#/$defs/SourceDependency" };
const refs = { type: "array", minItems: 1, uniqueItems: true, items: ref };
const text = { $ref: "#/$defs/StableId" };
const digest = { $ref: "#/$defs/Sha256" };
const timestamp = { $ref: "#/$defs/Timestamp" };
const nullableRef = { oneOf: [ref, { type: "null" }] };
const stringList = { type: "array", uniqueItems: true, items: text };
const enumOf = (...values) => ({ enum: values });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object", additionalProperties: false, required, properties,
});

const catalog = [
  {
    id: "QualifiedSupportSourceRef/v1", name: "QualifiedSupportSourceRefV1", parser: "parseQualifiedSupportSourceRefV1", slug: "qualified-support-source-ref-v1", kind: "SOURCE_EVIDENCE", dependencies: [],
    payload: object({ sourceRef: { $ref: "#/$defs/QualifiedSourceRef" } }),
  },
  {
    id: "SupportRedactionReceipt/v1", name: "SupportRedactionReceiptV1", parser: "parseSupportRedactionReceiptV1", slug: "support-redaction-receipt-v1", kind: "SOURCE_EVIDENCE", dependencies: ["QualifiedSupportSourceRef/v1"],
    payload: object({ sourceRef: ref, policyVersion: text, detectorVersions: stringList, omittedClassCounts: object({ PII: { type: "integer", minimum: 0 }, SECRET: { type: "integer", minimum: 0 }, RAW_PRIVATE: { type: "integer", minimum: 0 } }), result: enumOf("PASS", "BLOCKED"), redactedContentDigest: digest }),
  },
  {
    id: "SupportPrivacyRetentionRef/v1", name: "SupportPrivacyRetentionRefV1", parser: "parseSupportPrivacyRetentionRefV1", slug: "support-privacy-retention-ref-v1", kind: "SOURCE_EVIDENCE", dependencies: ["QualifiedSupportSourceRef/v1", "SupportRedactionReceipt/v1"],
    payload: object({ sourceRef: ref, dataCategory: enumOf("CUSTOMER_CONTENT", "IDENTITY", "OPERATIONAL_METADATA", "SUPPORT_EVIDENCE"), purpose: text, opaqueLocationRef: text, opaqueLocationVersion: text, encryptionAlias: text, encryptionVersion: text, retentionPolicyRef: ref, retainUntil: timestamp, legalHoldRef: nullableRef, redactionReceiptRef: ref, sourceReadbackRef: ref, tombstoneRef: nullableRef }),
  },
  {
    id: "SupportDataDispositionReceipt/v1", name: "SupportDataDispositionReceiptV1", parser: "parseSupportDataDispositionReceiptV1", slug: "support-data-disposition-receipt-v1", kind: "SOURCE_EVIDENCE", dependencies: ["QualifiedSupportSourceRef/v1", "SupportPrivacyRetentionRef/v1"],
    payload: object({ privacyRetentionRef: ref, objectCopyLineage: refs, actorAuthorityRef: ref, retentionState: enumOf("ACTIVE", "EXPIRED"), legalHoldState: enumOf("ACTIVE", "CLEARED", "UNKNOWN"), sourceDispositionReadbacks: refs, residualCopyRefs: { type: "array", uniqueItems: true, items: ref }, localDisposition: enumOf("RETAINED", "ERASED_LOCAL_ONLY"), remoteFinality: enumOf("NOT_FINAL", "SOURCE_CONFIRMED") }),
  },
  {
    id: "SupportPolicyEntitlementRef/v1", name: "SupportPolicyEntitlementRefV1", parser: "parseSupportPolicyEntitlementRefV1", slug: "support-policy-entitlement-ref-v1", kind: "SOURCE_EVIDENCE", dependencies: ["QualifiedSupportSourceRef/v1"],
    payload: object({ principalRef: ref, capability: text, action: text, entitlementRef: ref, policyRef: ref, slaRef: ref, channelRef: ref, providerRef: ref, workspaceRef: ref, featureRef: ref, killRef: ref, validFrom: timestamp, validUntil: timestamp, supersessionRef: nullableRef }),
  },
  {
    id: "SupportIntakeEvidence/v1", name: "SupportIntakeEvidenceV1", parser: "parseSupportIntakeEvidenceV1", slug: "support-intake-evidence-v1", kind: "SOURCE_EVIDENCE", dependencies: ["QualifiedSupportSourceRef/v1", "SupportRedactionReceipt/v1"],
    payload: object({ channel: enumOf("CHAT", "EMAIL", "FORM", "IN_APP"), sourceRef: ref, transportReceiptRef: ref, customerIdentityRef: ref, redactionReceiptRef: ref, provisionalSeverity: enumOf("P0", "P1", "P2", "P3"), caseRef: ref, p110OperationRef: ref, intakePayloadDigest: digest }),
  },
  {
    id: "SupportOwnershipAcceptanceEvidence/v1", name: "SupportOwnershipAcceptanceEvidenceV1", parser: "parseSupportOwnershipAcceptanceEvidenceV1", slug: "support-ownership-acceptance-evidence-v1", kind: "SOURCE_EVIDENCE", dependencies: ["QualifiedSupportSourceRef/v1", "SupportIntakeEvidence/v1"],
    payload: object({ caseRef: ref, proposedOwnerRef: ref, acceptedHumanAuthorityRef: ref, rosterCoverageRef: ref, acceptedAt: timestamp, p110OperationRef: ref }),
  },
  {
    id: "SupportSlaScheduleEvent/v1", name: "SupportSlaScheduleEventV1", parser: "parseSupportSlaScheduleEventV1", slug: "support-sla-schedule-event-v1", kind: "SOURCE_EVIDENCE", dependencies: ["QualifiedSupportSourceRef/v1", "SupportPolicyEntitlementRef/v1", "SupportOwnershipAcceptanceEvidence/v1"],
    payload: object({ caseRef: ref, caseVersion: text, policyRef: ref, severity: enumOf("P0", "P1", "P2", "P3"), condition: enumOf("DUE", "UPDATE_DUE", "HALF_BUDGET", "BREACH", "ESCALATION", "REOPEN", "CLOSURE_VERIFICATION_REQUIRED"), dueAt: timestamp, eventObservedAt: timestamp, schedulerPrincipalRef: ref, p110EventRef: ref, p111AttemptRef: ref }),
  },
  {
    id: "SupportCaseIncidentBinding/v1", name: "SupportCaseIncidentBindingV1", parser: "parseSupportCaseIncidentBindingV1", slug: "support-case-incident-binding-v1", kind: "SOURCE_EVIDENCE", dependencies: ["QualifiedSupportSourceRef/v1", "SupportOwnershipAcceptanceEvidence/v1"],
    payload: object({ caseRef: ref, incidentRef: ref, humanAcknowledgementRef: ref, recoverySourceRef: ref, boundAt: timestamp }),
  },
  {
    id: "SupportClosureEvidence/v1", name: "SupportClosureEvidenceV1", parser: "parseSupportClosureEvidenceV1", slug: "support-closure-evidence-v1", kind: "SOURCE_EVIDENCE", dependencies: ["QualifiedSupportSourceRef/v1", "SupportOwnershipAcceptanceEvidence/v1", "SupportSlaScheduleEvent/v1"],
    payload: object({ priorCaseRef: ref, closedCaseRef: ref, priorAuditHeadRef: ref, closedAuditHeadRef: ref, resolutionActionRef: ref, verifiedReplyRef: nullableRef, humanNoReplyExceptionRef: nullableRef, ownerAcceptanceRef: ref, slaStopRef: ref, sourceReadbackRefs: refs, latestInboundWatermark: text, closureState: enumOf("BLOCKED_INCOMPLETE", "READY_FOR_OWNER_COMMIT"), closureDigest: digest }),
  },
  {
    id: "SupportReopenEvidence/v1", name: "SupportReopenEvidenceV1", parser: "parseSupportReopenEvidenceV1", slug: "support-reopen-evidence-v1", kind: "SOURCE_EVIDENCE", dependencies: ["QualifiedSupportSourceRef/v1", "SupportClosureEvidence/v1"],
    payload: object({ closureEvidenceRef: ref, inboundReceiptRef: ref, inboundMessageRef: ref, closureWatermark: text, inboundWatermark: text, priorCaseVersion: text, newCaseVersion: text, newSlaEpochRef: ref, newDeadline: timestamp, p110OperationRef: ref, reopenState: enumOf("BLOCKED_INCOMPLETE", "READY_FOR_OWNER_COMMIT") }),
  },
  {
    id: "LegacySupportQuarantineManifest/v1", name: "LegacySupportQuarantineManifestV1", parser: "parseLegacySupportQuarantineManifestV1", slug: "legacy-support-quarantine-manifest-v1", kind: "SOURCE_EVIDENCE", dependencies: ["QualifiedSupportSourceRef/v1"],
    payload: object({ p110ObservationRef: ref, relation: text, schemaDigest: digest, primaryKeyDigest: digest, rowCount: { type: "integer", minimum: 0 }, rowRootDigest: digest, watermark: text, sensitivity: enumOf("PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"), tenantPosture: enumOf("TENANT_BOUND", "TENANT_UNKNOWN"), sourcePosture: enumOf("LEGACY_UNTRUSTED", "CANONICAL_ADMITTED"), reverseBoundary: enumOf("EMPTY_PRE_PIN_ONLY", "FORWARD_ONLY_AFTER_PIN"), containsCustomerValues: { const: false } }),
  },
  {
    id: "SupportPolicyEntitlementReadPacket/v1", name: "SupportPolicyEntitlementReadPacketV1", parser: "parseSupportPolicyEntitlementReadPacketV1", slug: "support-policy-entitlement-read-packet-v1", kind: "READ_PROJECTION", dependencies: ["SupportPolicyEntitlementRef/v1"],
    payload: object({ policyEntitlementRef: ref, stageResults: object({ intake: text, ownership: text, investigation: text, slaClaim: text, escalation: text, customerReply: text, closure: text, privacyDisposition: text }), snapshotDigest: digest, derivedStatus: enumOf("AVAILABLE", "BLOCKED_INCOMPLETE") }),
  },
  {
    id: "SupportRosterCoverageReadPacket/v1", name: "SupportRosterCoverageReadPacketV1", parser: "parseSupportRosterCoverageReadPacketV1", slug: "support-roster-coverage-read-packet-v1", kind: "READ_PROJECTION", dependencies: ["SupportOwnershipAcceptanceEvidence/v1"],
    payload: object({ humanAuthorityRef: ref, membershipRef: ref, rosterPolicyRef: ref, coverageWindowRefs: refs, primaryHumanRef: ref, plannedAbsenceRef: ref, substituteRef: ref, sourceReadbackRef: ref, derivedCoverage: enumOf("COVERED", "BLOCKED_INCOMPLETE"), snapshotDigest: digest }),
  },
  {
    id: "SupportPrivacyRetentionReadPacket/v1", name: "SupportPrivacyRetentionReadPacketV1", parser: "parseSupportPrivacyRetentionReadPacketV1", slug: "support-privacy-retention-read-packet-v1", kind: "READ_PROJECTION", dependencies: ["SupportPrivacyRetentionRef/v1", "SupportDataDispositionReceipt/v1"],
    payload: object({ privacyRetentionRefs: refs, dispositionReceiptRefs: refs, copyInventoryRefs: refs, redactionState: text, retentionState: text, holdState: text, erasureState: text, derivedStatus: enumOf("AVAILABLE", "BLOCKED_INCOMPLETE"), snapshotDigest: digest }),
  },
  {
    id: "SupportLegacyCompatibilityReadPacket/v1", name: "SupportLegacyCompatibilityReadPacketV1", parser: "parseSupportLegacyCompatibilityReadPacketV1", slug: "support-legacy-compatibility-read-packet-v1", kind: "READ_PROJECTION", dependencies: ["LegacySupportQuarantineManifest/v1", "SupportPrivacyRetentionRef/v1"],
    payload: object({ quarantineManifestRef: ref, relationRef: ref, rowRootDigest: digest, tenantPosture: text, sourcePosture: text, orphanState: text, privacyRetentionRef: ref, redactedDigest: digest, opaquePrivateRef: text, canonicalAdmissionRef: ref, replayState: text, derivedStatus: enumOf("AVAILABLE", "BLOCKED_INCOMPLETE") }),
  },
  {
    id: "SupportInvestigationReadPacket/v1", name: "SupportInvestigationReadPacketV1", parser: "parseSupportInvestigationReadPacketV1", slug: "support-investigation-read-packet-v1", kind: "READ_PROJECTION", dependencies: ["QualifiedSupportSourceRef/v1", "SupportRedactionReceipt/v1", "SupportPolicyEntitlementReadPacket/v1", "SupportRosterCoverageReadPacket/v1"],
    payload: object({ caseRef: ref, approvedKnowledgeRefs: refs, redactedEvidenceRefs: refs, privateOpaqueRefs: refs, redactionReceiptRefs: refs, policyReadPacketRef: ref, rosterReadPacketRef: ref, releaseRef: ref, flagRef: ref, engineerAcceptanceRef: ref, closureReadbackRef: ref, derivedStatus: enumOf("AVAILABLE", "BLOCKED_INCOMPLETE"), snapshotDigest: digest }),
  },
  {
    id: "SupportIncidentEscalationReadPacket/v1", name: "SupportIncidentEscalationReadPacketV1", parser: "parseSupportIncidentEscalationReadPacketV1", slug: "support-incident-escalation-read-packet-v1", kind: "READ_PROJECTION", dependencies: ["SupportCaseIncidentBinding/v1", "SupportPolicyEntitlementReadPacket/v1", "SupportRosterCoverageReadPacket/v1"],
    payload: object({ caseIncidentBindingRef: ref, currentCaseRef: ref, ownerAcceptanceRef: ref, policyReadPacketRef: ref, killRef: ref, observationRefs: refs, dlqRef: ref, reconciliationRef: ref, p111RecoveryRef: ref, incidentRecoverySourceRef: ref, conditionMatrix: object({ intakeLoss: text, unownedCase: text, overdueUpdate: text, slaBreach: text, failedEscalation: text, undeliveredReply: text, closureRace: text, privacyBlock: text, policyKillDenial: text }), derivedStatus: enumOf("AVAILABLE", "BLOCKED_INCOMPLETE"), snapshotDigest: digest }),
  },
  {
    id: "SupportObservabilityRecoveryReadPacket/v1", name: "SupportObservabilityRecoveryReadPacketV1", parser: "parseSupportObservabilityRecoveryReadPacketV1", slug: "support-observability-recovery-read-packet-v1", kind: "READ_PROJECTION", dependencies: ["QualifiedSupportSourceRef/v1", "SupportSlaScheduleEvent/v1", "SupportClosureEvidence/v1", "SupportReopenEvidence/v1", "SupportIncidentEscalationReadPacket/v1"],
    payload: object({ caseRef: ref, ownerAcceptanceRef: ref, policyReadPacketRef: ref, signalRefs: refs, operationRef: ref, attemptRefs: refs, dlqRefs: refs, reconciliationRefs: refs, recoveryRefs: refs, sourceReadbackRefs: refs, conditionMatrix: object({ intakeLoss: text, unownedCase: text, overdueUpdate: text, slaBreach: text, failedEscalation: text, undeliveredReply: text, closureRace: text, privacyBlock: text, policyKillDenial: text }), derivedStatus: enumOf("AVAILABLE", "BLOCKED_INCOMPLETE"), snapshotDigest: digest }),
  },
  {
    id: "SupportOutputHandoff/v1", name: "SupportOutputHandoffV1", parser: "parseSupportOutputHandoffV1", slug: "support-output-handoff-v1", kind: "EMULATOR_RECEIPT", dependencies: ["SupportInvestigationReadPacket/v1", "SupportIncidentEscalationReadPacket/v1", "SupportObservabilityRecoveryReadPacket/v1"],
    payload: object({
      evidence_bundle: object({ caseSnapshot: { $ref: "../../../core/v1/luzione-core-contracts-v1.schema.json#/$defs/SupportCase" }, investigationReadPacketRef: ref, qualifiedSourceRefs: refs }),
      uncertainty_statement: object({ statements: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 500 } }, unresolvedSourceRefs: refs }),
      severity_recommendation: object({ value: enumOf("P0", "P1", "P2", "P3"), authoritative: { const: false }, sourceRefs: refs }),
      proposed_SupportAction: { $ref: "../../../core/v1/luzione-core-contracts-v1.schema.json#/$defs/SupportAction" },
      draft_CustomerReply: { $ref: "../../../core/v1/luzione-core-contracts-v1.schema.json#/$defs/CustomerReply" },
    }),
  },
];

const stableIdPattern = "^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$";
const definitions = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://contracts.luzione.ai/support/v1/schemas/internal-definitions.schema.json",
  title: "Luzione support v1 internal definitions",
  description: "Internal-only byte, envelope, ABSENT and qualified-source rules. This is not a public manifest entry.",
  "x-originalByteRules": {
    inputType: "Uint8Array",
    maxBytes: 262144,
    utf8: "FATAL_NO_BOM",
    rejectDuplicateKeys: true,
    rejectUnpairedSurrogates: true,
    rejectIllegalControls: true,
    normalization: "NONE",
  },
  $defs: {
    StableId: { type: "string", minLength: 1, maxLength: 200, pattern: stableIdPattern },
    Uuid: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" },
    Sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
    GitSha: { type: "string", pattern: "^[0-9a-f]{40}$" },
    Timestamp: { type: "string", format: "date-time" },
    TypedAbsent: object({ expectedOwner: text, expectedType: text, expectedVersion: text, reason: text, observedAt: timestamp }),
    QualifiedSourceRef: object({
      state: { const: "PRESENT" }, repository: text, objectType: text, tenantId: text, objectId: text,
      version: text, contentHash: digest, sourceHash: digest,
      validity: object({ observedAt: timestamp, validUntil: timestamp }),
      readback: object({ ref: text, observedAt: timestamp }),
      privacy: object({ class: enumOf("PUBLIC", "INTERNAL", "REDACTED", "RAW_PRIVATE"), redactionReceiptRef: { oneOf: [text, { type: "null" }] } }),
      review: object({ state: enumOf("NOT_REQUIRED", "APPROVED", "BLOCKED"), reviewerRef: { oneOf: [text, { type: "null" }] }, reviewedAt: { oneOf: [timestamp, { type: "null" }] } }),
      supersedesRef: { oneOf: [text, { type: "null" }] },
    }),
    SourceDependency: { oneOf: [{ $ref: "#/$defs/QualifiedSourceRef" }, { $ref: "#/$defs/TypedAbsent" }] },
    DocumentEnvelope: object({
      contractVersion: text, documentId: { $ref: "#/$defs/Uuid" }, tenantId: text,
      idempotencyKey: text, payloadDigest: digest, observedAt: timestamp,
      supersedesDocumentId: { oneOf: [{ $ref: "#/$defs/Uuid" }, { type: "null" }] },
      effectMode: { const: "NO_EFFECT" }, finality: { const: "NOT_FINAL" },
      dependencyState: enumOf("PRESENT", "ABSENT", "BLOCKED_INCOMPLETE"), payload: { type: "object" },
    }),
    ReadPacketEnvelope: object({
      contractVersion: text, documentId: { $ref: "#/$defs/Uuid" }, tenantId: text,
      idempotencyKey: text, payloadDigest: digest, observedAt: timestamp,
      supersedesDocumentId: { oneOf: [{ $ref: "#/$defs/Uuid" }, { type: "null" }] },
      effectMode: { const: "NO_EFFECT" }, finality: { const: "NOT_FINAL" },
      dependencyState: enumOf("PRESENT", "ABSENT", "BLOCKED_INCOMPLETE"), readPacketState: enumOf("AVAILABLE", "BLOCKED_INCOMPLETE"), payload: { type: "object" },
    }),
    ...Object.fromEntries(catalog.map((entry) => [`${entry.name}Payload`, entry.payload])),
  },
  "x-supportDocumentCatalog": catalog.map(({ id, name, parser, slug, kind, dependencies, payload }) => ({ id, name, parser, slug, kind, dependencies, payloadFields: Object.keys(payload.properties) })),
};

const render = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const publicSchemas = new Map(catalog.map((entry) => {
  const envelope = entry.kind === "READ_PROJECTION" ? "ReadPacketEnvelope" : "DocumentEnvelope";
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://contracts.luzione.ai/support/v1/schemas/${entry.slug}.schema.json`,
    title: entry.id,
    allOf: [
      { $ref: `./internal-definitions.schema.json#/$defs/${envelope}` },
      { type: "object", properties: { contractVersion: { const: entry.id }, payload: { $ref: `./internal-definitions.schema.json#/$defs/${entry.name}Payload` } } },
    ],
    unevaluatedProperties: false,
  };
  return [`schemas/${entry.slug}.schema.json`, render(schema)];
}));

const definitionsText = render(definitions);
const schemaDigests = Object.fromEntries([...publicSchemas].map(([path, body]) => [catalog.find((entry) => path.includes(entry.slug)).id, sha256(body)]));
const manifest = {
  manifestVersion: "LuzioneSupportContractBundleManifest/v1",
  bundleVersion: "LuzioneSupportContractBundle/v1",
  controllerAuthority: "f655931439d0f9fabfdbeb6e8a6a1271894c1dd6",
  implementationPacketFingerprintSha256: "89492596874d04cc58b819ac005ec7bd08ed77328f5eafe666e54e075ef246a0",
  collisionFingerprintSha256: "b388706239d0675febc634e0e9276a368b6e1664a42914ebee60a8edce7fb684",
  effectAuthority: "NO_EFFECT",
  finality: "NOT_FINAL",
  productionReady: false,
  publicEntryCount: 20,
  split: { sourceEvidence: 12, readProjections: 7, emulatorReceipts: 1 },
  internalDefinitions: { path: "contracts/support/v1/schemas/internal-definitions.schema.json", sha256: sha256(definitionsText), public: false },
  operationsV3Dependency: { state: "ABSENT", reason: "AWAITING_OPS_CONTRACTS_ASSURE_04", expectedOwner: "CIBOTFLOW/Luzione-API", expectedType: "LuzioneOperationsEvidenceLedger", expectedVersion: "LuzioneOperationsEvidenceLedger/v3" },
  frozenSpine: {
    baseSha: "bb4c9e3e337c64d30991badfd43bb182ad0a8a16",
    coreTreeGitSha: "d57ccc4cccd97b37acd1a1575b1e07ede5787349",
    coreSdkTreeGitSha: "d594fa014d7020fdf8386c7a6926ff9b573ac355",
    p110P111TreeGitSha: "a22ce25cd93e362ff44688b456b63e3eb8ec10e2",
    coreSchemaSha256: "13edcb0d5ec3509e21bc4a299e442c81072426772e7419a1b56160697b05be2d",
    coreManifestSha256: "a3bf790b2c75bcba1023aa8f5d87abb01e638a4d56a8c626a58f78c26a4232dc",
    coreTypesSha256: "a62c71cbf7e23e5dbae8df227b7f69cd29f327beb9b342646eab69a0bbddef6f",
    coreParserSha256: "5e1b61f8083d222bb3e38adecdf12347447753b5d448fbe36cffba93cdc27630",
    coreFixturesSha256: "2d2c9d71d156bf57b6a1e26967dde8101e920aeeecafdf5c481081e5e95b74d0",
    p110EventSha256: "cba2fd316401c84cb445235b35417af29fea942f3fad5d5e73777acb84639241",
    p110CommandSha256: "2627de6bd434c22b88ac43e0bf0f6c97d833ad75cd7fd6c55da657ccef3b5630",
    p111StateSha256: "548c52c09dc26350129b39d6a2949a380e9e3e76bbeb7d0981c0e0ef5de94bfd",
    p111RetrySha256: "36c0ae43e1a96639c38b1817763516c7e80923ff80b2929922e96f5fee1786ce",
    p111RecoverySha256: "35ab18554e685f3613de8a65b93596e3ec2ef4d47c6a38f892a6a21d1877b629",
  },
  entries: catalog.map((entry, index) => ({ order: index + 1, contractVersion: entry.id, kind: entry.kind, schemaPath: `contracts/support/v1/schemas/${entry.slug}.schema.json`, schemaSha256: schemaDigests[entry.id], dependencies: entry.dependencies })),
  generatedSdk: { path: "contracts/support/v1/generated/typescript/index.ts", inputType: "Uint8Array", publicTypes: catalog.map((entry) => entry.name), publicParsers: catalog.map((entry) => entry.parser), forbiddenExports: ["builder", "store", "resolver", "provider", "writer", "migration", "scheduler", "finalizer"] },
  generation: { command: "node contracts/support/v1/generated/typescript/generate.mjs --check", deterministic: true },
};

const template = readFileSync(templatePath, "utf8");
const catalogRuntime = catalog.map(({ id, name, parser, slug, kind, dependencies, payload }) => ({ id, name, parser, slug, kind, dependencies, payloadFields: Object.keys(payload.properties), payloadSchema: payload }));
const typeExports = catalog.map((entry) => `export type ${entry.name} = SupportEnvelope<"${entry.id}", ${JSON.stringify(Object.keys(entry.payload.properties))}[number]>;`).join("\n");
const parserExports = catalog.map((entry) => `export function ${entry.parser}(bytes: Uint8Array, context?: SupportParseContext): ${entry.name} { return parseDocument(bytes, "${entry.id}", context) as ${entry.name}; }`).join("\n\n");
const sdk = template
  .replace("__CATALOG__", JSON.stringify(catalogRuntime, null, 2))
  .replace("__TYPE_EXPORTS__", typeExports)
  .replace("__PARSER_EXPORTS__", parserExports);

const outputs = new Map([
  ["schemas/internal-definitions.schema.json", definitionsText],
  ...publicSchemas,
  ["manifest.json", render(manifest)],
  ["generated/typescript/index.ts", sdk],
]);

let mismatches = 0;
for (const [relative, body] of outputs) {
  const path = resolve(supportRoot, relative);
  if (mode === "--write") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  } else {
    let current = "";
    try { current = readFileSync(path, "utf8"); } catch {}
    if (current !== body) {
      process.stderr.write(`generated artifact drift: ${relative}\n`);
      mismatches += 1;
    }
  }
}

if (!["--write", "--check"].includes(mode)) throw new Error(`unsupported mode ${mode}`);
if (mismatches > 0) process.exitCode = 1;
else process.stdout.write(`${mode === "--write" ? "generated" : "verified"} ${outputs.size} deterministic support artifacts\n`);
