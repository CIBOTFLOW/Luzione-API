import {
  parseA02CommandConsumerFixture,
  parseA02ReadbackConsumerFixture,
  parseA02ReceiptConsumerFixture,
} from "@/modules/shared-contract-drafts/consumerCompatibility";
import {
  CORE_A02_PINS,
  CORE_CONTRACT_BUNDLE_VERSION,
  CORE_CONTRACT_VERSIONS,
  CORE_EFFECT_MODES,
  type ConnectorBindingV1,
  type CoreContractVersion,
  type CustomerReplyV1,
  type ImportBatchV1,
  type ImportReceiptV1,
  type LuzioneCoreContractDocument,
  type LuzioneCoreFeatureFlagsV1,
  type LuzioneCoreReleaseManifestV1,
  type SetupMandateV1,
  type SultanOperationV1,
  type SultanReadbackV1,
  type SultanReceiptV1,
  type SupportActionV1,
  type SupportCaseV1,
  type SyncReceiptV1,
  type TenantBlueprintV1,
} from "./contracts";
import { LuzioneCoreCompatibilityError, type LuzioneCoreCompatibilityErrorCode } from "./compatibilityError";
import { SEED_PRODUCT_CONTRACT_VERSIONS } from "./seedProductContracts";
import { parseLuzioneSeedProductContractDocument } from "./seedProductConsumerSdk";

export { LuzioneCoreCompatibilityError, type LuzioneCoreCompatibilityErrorCode } from "./compatibilityError";

type JsonObject = Record<string, unknown>;

const REQUIRED_PROHIBITIONS = [
  "CHANGE_SHARED_CODE_OR_SCHEMA",
  "COMPLETE_OAUTH",
  "CREATE_OR_READ_CREDENTIAL",
  "CROSS_TENANT",
  "DESTRUCTIVE_DATA_CLEANUP",
  "EXPAND_AUTHORITY",
  "SEND_EXTERNAL_COMMUNICATION",
] as const;

export function parseSultanOperationV1(value: unknown): SultanOperationV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.sultanOperation, [
    "a02Command", "a02Pins", "causation", "contractVersion", "deadline", "effectMode",
    "operationId", "reservation", "versionIntent",
  ], "sultanOperation");
  const operationId = uuid(envelope.operationId, "sultanOperation.operationId");
  const command = parseA02CommandConsumerFixture(envelope.a02Command);
  parseA02Pins(envelope.a02Pins);
  if (command.commandId !== operationId) {
    mismatch("Sultan operationId must remain the exact A02 commandId across retries.");
  }
  const causation = exact(envelope.causation, ["correlationId", "requestId", "traceId"], "sultanOperation.causation");
  for (const key of ["correlationId", "requestId", "traceId"] as const) id(causation[key], `sultanOperation.causation.${key}`);
  if (causation.correlationId !== command.context.request.correlationId
    || causation.requestId !== command.context.request.requestId
    || causation.traceId !== command.context.request.traceId) {
    mismatch("Sultan operation causation must match the server-derived A02 request context.");
  }
  const effectMode = enumeration(envelope.effectMode, CORE_EFFECT_MODES, "sultanOperation.effectMode");
  const reservation = exact(envelope.reservation, ["reservedAt", "reservationReceiptRef", "state"], "sultanOperation.reservation");
  const reservationState = enumeration(reservation.state, [
    "NOT_RESERVED_G0", "RESERVED", "CONFLICT", "INDETERMINATE",
  ], "sultanOperation.reservation.state");
  timestampOrNull(reservation.reservedAt, "sultanOperation.reservation.reservedAt");
  idOrNull(reservation.reservationReceiptRef, "sultanOperation.reservation.reservationReceiptRef");
  if (reservationState === "NOT_RESERVED_G0") {
    if (effectMode !== "NO_EFFECT" || reservation.reservedAt !== null || reservation.reservationReceiptRef !== null) {
      authority("An unreserved G0 operation must remain NO_EFFECT and have no reservation evidence.");
    }
  } else if (reservationState === "RESERVED"
    && (reservation.reservedAt === null || reservation.reservationReceiptRef === null)) {
    invalid("A RESERVED operation requires reservation time and receipt evidence.");
  }
  const versionIntent = exact(envelope.versionIntent, [
    "preconditionVersion", "targetVersionAtRequest",
  ], "sultanOperation.versionIntent");
  id(versionIntent.preconditionVersion, "sultanOperation.versionIntent.preconditionVersion");
  id(versionIntent.targetVersionAtRequest, "sultanOperation.versionIntent.targetVersionAtRequest");
  if (versionIntent.preconditionVersion !== command.expectedObjectVersion
    || versionIntent.targetVersionAtRequest !== command.target.objectVersion) {
    mismatch("Sultan operation version intent must preserve the two A02 request-time version fields.");
  }
  const deadline = timestamp(envelope.deadline, "sultanOperation.deadline");
  if (Date.parse(deadline) <= Date.parse(command.requestedAt)) invalid("Sultan operation deadline must follow requestedAt.");
  return envelope as SultanOperationV1;
}

export function parseSultanReceiptV1(value: unknown, operation: SultanOperationV1): SultanReceiptV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.sultanReceipt, [
    "a02Receipt", "contractVersion", "effect", "finality", "issuedAt", "issuedBy",
    "operationRef", "versions",
  ], "sultanReceipt");
  const receipt = parseA02ReceiptConsumerFixture(envelope.a02Receipt, operation.a02Command);
  const operationRef = exact(envelope.operationRef, ["operationId", "payloadHash"], "sultanReceipt.operationRef");
  uuid(operationRef.operationId, "sultanReceipt.operationRef.operationId");
  digest(operationRef.payloadHash, "sultanReceipt.operationRef.payloadHash");
  if (operationRef.operationId !== operation.operationId
    || operationRef.payloadHash !== operation.a02Command.payloadHash) {
    replay("Sultan receipt must close the exact operation and canonical payload hash.");
  }
  const versions = exact(envelope.versions, [
    "committedVersion", "preconditionVersion", "targetVersionAtRequest",
  ], "sultanReceipt.versions");
  for (const key of ["committedVersion", "preconditionVersion", "targetVersionAtRequest"] as const) {
    id(versions[key], `sultanReceipt.versions.${key}`);
  }
  if (versions.preconditionVersion !== operation.versionIntent.preconditionVersion
    || versions.targetVersionAtRequest !== operation.versionIntent.targetVersionAtRequest
    || versions.committedVersion !== receipt.object.version) {
    mismatch("Sultan receipt versions must preserve precondition, request-time target and committed versions.");
  }
  const effect = exact(envelope.effect, ["actual", "providerAcknowledgementRef"], "sultanReceipt.effect");
  const actualEffect = enumeration(effect.actual, CORE_EFFECT_MODES, "sultanReceipt.effect.actual");
  idOrNull(effect.providerAcknowledgementRef, "sultanReceipt.effect.providerAcknowledgementRef");
  if (operation.effectMode === "NO_EFFECT" && actualEffect !== "NO_EFFECT") {
    authority("A NO_EFFECT operation cannot produce an effectful receipt.");
  }
  if (receipt.idempotency.replay && receipt.idempotency.payloadHash !== operation.a02Command.payloadHash) {
    replay("Replay receipts must retain the original operation payload hash.");
  }
  const finality = enumeration(envelope.finality, ["DOMAIN_COMMITTED", "DISPATCH_PENDING"], "sultanReceipt.finality");
  if (finality !== receipt.state) mismatch("Sultan receipt finality must preserve the A02 receipt state.");
  const issuedBy = id(envelope.issuedBy, "sultanReceipt.issuedBy");
  if (issuedBy !== receipt.object.ownerProject) mismatch("Only the canonical object owner may issue the receipt.");
  timestamp(envelope.issuedAt, "sultanReceipt.issuedAt");
  return envelope as SultanReceiptV1;
}

export function parseSultanReadbackV1(
  value: unknown,
  operation: SultanOperationV1,
  receipt: SultanReceiptV1,
): SultanReadbackV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.sultanReadback, [
    "a02Readback", "contractVersion", "operationId", "receiptId", "verification", "versions",
  ], "sultanReadback");
  const readback = parseA02ReadbackConsumerFixture(envelope.a02Readback, receipt.a02Receipt);
  if (envelope.operationId !== operation.operationId || envelope.receiptId !== receipt.a02Receipt.receiptId) {
    mismatch("Sultan readback must close the exact operation and owner-issued receipt.");
  }
  uuid(envelope.operationId, "sultanReadback.operationId");
  id(envelope.receiptId, "sultanReadback.receiptId");
  const verification = exact(envelope.verification, [
    "businessFinal", "finality", "freshUntil", "observedAt", "sourceReadbackRef",
  ], "sultanReadback.verification");
  boolean(verification.businessFinal, "sultanReadback.verification.businessFinal");
  enumeration(verification.finality, [
    "DOMAIN_COMMITTED", "MISSING", "PROVIDER_ACKNOWLEDGED", "RECONCILING", "SOURCE_CONFIRMED",
  ], "sultanReadback.verification.finality");
  timestampOrNull(verification.freshUntil, "sultanReadback.verification.freshUntil");
  timestampOrNull(verification.observedAt, "sultanReadback.verification.observedAt");
  idOrNull(verification.sourceReadbackRef, "sultanReadback.verification.sourceReadbackRef");
  if (verification.businessFinal !== readback.businessFinal
    || verification.finality !== readback.finality
    || verification.freshUntil !== readback.freshness.freshUntil
    || verification.observedAt !== readback.freshness.observedAt
    || verification.sourceReadbackRef !== readback.evidence.sourceReadbackRef) {
    mismatch("Sultan readback verification must be a lossless A02 readback projection.");
  }
  const versions = exact(envelope.versions, ["committedVersion", "observedVersion"], "sultanReadback.versions");
  id(versions.committedVersion, "sultanReadback.versions.committedVersion");
  idOrNull(versions.observedVersion, "sultanReadback.versions.observedVersion");
  if (versions.committedVersion !== receipt.versions.committedVersion
    || versions.observedVersion !== readback.object.version) {
    mismatch("Sultan readback must distinguish the committed and observed object versions.");
  }
  return envelope as SultanReadbackV1;
}

export function parseTenantBlueprintV1(value: unknown): TenantBlueprintV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.tenantBlueprint, [
    "approval", "blueprintId", "contractVersion", "sections", "tenantId", "version",
  ], "tenantBlueprint");
  uuid(envelope.blueprintId, "tenantBlueprint.blueprintId");
  id(envelope.tenantId, "tenantBlueprint.tenantId");
  id(envelope.version, "tenantBlueprint.version");
  const approval = exact(envelope.approval, ["approvalRef", "approvedAt", "state"], "tenantBlueprint.approval");
  const state = enumeration(approval.state, ["DRAFT", "APPROVED", "SUPERSEDED"], "tenantBlueprint.approval.state");
  idOrNull(approval.approvalRef, "tenantBlueprint.approval.approvalRef");
  timestampOrNull(approval.approvedAt, "tenantBlueprint.approval.approvedAt");
  if (state === "APPROVED" && (approval.approvalRef === null || approval.approvedAt === null)) {
    invalid("An approved Tenant Blueprint requires immutable approval evidence.");
  }
  if (state === "DRAFT" && (approval.approvalRef !== null || approval.approvedAt !== null)) {
    invalid("A draft Tenant Blueprint cannot claim approval evidence.");
  }
  const sections = exact(envelope.sections, [
    "aiPolicies", "approvals", "connectors", "fields", "icp", "retention", "roles",
    "stages", "terminology", "workflows",
  ], "tenantBlueprint.sections");
  for (const key of [
    "aiPolicies", "approvals", "connectors", "fields", "icp", "retention", "roles", "stages", "workflows",
  ] as const) stringArray(sections[key], true, `tenantBlueprint.sections.${key}`);
  const terminology = object(sections.terminology, "tenantBlueprint.sections.terminology");
  if (Object.keys(terminology).length === 0) invalid("Tenant Blueprint terminology must not be empty.");
  for (const [key, item] of Object.entries(terminology)) {
    id(key, "tenantBlueprint.sections.terminology key");
    id(item, `tenantBlueprint.sections.terminology.${key}`);
  }
  return envelope as TenantBlueprintV1;
}

export function parseSetupMandateV1(value: unknown, blueprint?: TenantBlueprintV1): SetupMandateV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.setupMandate, [
    "active", "allowedActions", "approvalRef", "blueprintRef", "contractVersion", "effectCeiling",
    "expiresAt", "limits", "mandateId", "prohibitedActions", "rollbackPlanRef", "tenantId",
  ], "setupMandate");
  uuid(envelope.mandateId, "setupMandate.mandateId");
  id(envelope.tenantId, "setupMandate.tenantId");
  boolean(envelope.active, "setupMandate.active");
  id(envelope.approvalRef, "setupMandate.approvalRef");
  id(envelope.rollbackPlanRef, "setupMandate.rollbackPlanRef");
  const expiresAt = timestamp(envelope.expiresAt, "setupMandate.expiresAt");
  const actions = stringArray(envelope.allowedActions, true, "setupMandate.allowedActions");
  for (const action of actions) enumeration(action, [
    "APPLY_TENANT_CONFIGURATION", "DRY_RUN_IMPORT", "RECONCILE_IMPORT", "VALIDATE_CONNECTOR_READBACK",
  ], "setupMandate.allowedActions[]");
  enumeration(envelope.effectCeiling, [
    "NO_EFFECT", "SANDBOX_ONLY", "REVERSIBLE_TENANT_CONFIGURATION",
  ], "setupMandate.effectCeiling");
  const prohibited = stringArray(envelope.prohibitedActions, true, "setupMandate.prohibitedActions");
  for (const required of REQUIRED_PROHIBITIONS) {
    if (!prohibited.includes(required)) authority(`Setup Mandate must prohibit ${required}.`);
  }
  const blueprintRef = exact(envelope.blueprintRef, ["blueprintId", "version"], "setupMandate.blueprintRef");
  uuid(blueprintRef.blueprintId, "setupMandate.blueprintRef.blueprintId");
  id(blueprintRef.version, "setupMandate.blueprintRef.version");
  const limits = exact(envelope.limits, ["maxImportRecords", "maxRuntimeMinutes"], "setupMandate.limits");
  positiveInteger(limits.maxImportRecords, "setupMandate.limits.maxImportRecords");
  positiveInteger(limits.maxRuntimeMinutes, "setupMandate.limits.maxRuntimeMinutes");
  if (envelope.active && Date.parse(expiresAt) <= Date.now()) expired("An active Setup Mandate must not be expired.");
  if (blueprint) {
    if (envelope.tenantId !== blueprint.tenantId) tenantMismatch("Setup Mandate tenant must match its Blueprint.");
    if (blueprintRef.blueprintId !== blueprint.blueprintId || blueprintRef.version !== blueprint.version) {
      mismatch("Setup Mandate must pin the exact approved Blueprint version.");
    }
    if (blueprint.approval.state !== "APPROVED") authority("Setup Mandate requires an approved Tenant Blueprint.");
  }
  return envelope as SetupMandateV1;
}

export function parseImportBatchV1(value: unknown, mandate?: SetupMandateV1): ImportBatchV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.importBatch, [
    "batchId", "contractVersion", "dedupeKey", "effectMode", "mandateRef", "mappingVersion",
    "source", "stagedCounts", "status", "tenantId",
  ], "importBatch");
  uuid(envelope.batchId, "importBatch.batchId");
  id(envelope.tenantId, "importBatch.tenantId");
  id(envelope.mandateRef, "importBatch.mandateRef");
  id(envelope.mappingVersion, "importBatch.mappingVersion");
  id(envelope.dedupeKey, "importBatch.dedupeKey");
  enumeration(envelope.effectMode, ["NO_EFFECT", "SANDBOX_ONLY"], "importBatch.effectMode");
  enumeration(envelope.status, ["STAGED", "VALIDATED", "RECONCILIATION_REQUIRED"], "importBatch.status");
  const source = exact(envelope.source, ["consentRef", "digest", "kind", "provenanceRef"], "importBatch.source");
  id(source.consentRef, "importBatch.source.consentRef");
  digest(source.digest, "importBatch.source.digest");
  enumeration(source.kind, ["CSV", "DOCUMENT", "XLSX"], "importBatch.source.kind");
  id(source.provenanceRef, "importBatch.source.provenanceRef");
  const counts = exact(envelope.stagedCounts, ["records", "rejected"], "importBatch.stagedCounts");
  nonNegativeInteger(counts.records, "importBatch.stagedCounts.records");
  nonNegativeInteger(counts.rejected, "importBatch.stagedCounts.rejected");
  if (mandate) {
    if (envelope.tenantId !== mandate.tenantId) tenantMismatch("Import Batch tenant must match its Setup Mandate.");
    if (envelope.mandateRef !== mandate.mandateId) mismatch("Import Batch must pin the exact Setup Mandate.");
    if (Number(counts.records) > mandate.limits.maxImportRecords) authority("Import Batch exceeds the mandate record limit.");
  }
  return envelope as ImportBatchV1;
}

export function parseImportReceiptV1(value: unknown, batch?: ImportBatchV1): ImportReceiptV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.importReceipt, [
    "batchId", "contractVersion", "counts", "effectMode", "exceptionRefs", "finality",
    "reconciliationRef", "rollbackRef", "tenantId",
  ], "importReceipt");
  uuid(envelope.batchId, "importReceipt.batchId");
  id(envelope.tenantId, "importReceipt.tenantId");
  enumeration(envelope.effectMode, ["NO_EFFECT", "SANDBOX_ONLY"], "importReceipt.effectMode");
  const finality = enumeration(envelope.finality, [
    "VALIDATED_NO_EFFECT", "STAGED", "RECONCILIATION_REQUIRED",
  ], "importReceipt.finality");
  const counts = exact(envelope.counts, ["accepted", "duplicates", "rejected", "total"], "importReceipt.counts");
  for (const key of ["accepted", "duplicates", "rejected", "total"] as const) {
    nonNegativeInteger(counts[key], `importReceipt.counts.${key}`);
  }
  if (Number(counts.accepted) + Number(counts.duplicates) + Number(counts.rejected) !== counts.total) {
    invalid("Import Receipt counts must close exactly.");
  }
  stringArray(envelope.exceptionRefs, false, "importReceipt.exceptionRefs");
  idOrNull(envelope.reconciliationRef, "importReceipt.reconciliationRef");
  id(envelope.rollbackRef, "importReceipt.rollbackRef");
  if (finality === "RECONCILIATION_REQUIRED" && envelope.reconciliationRef === null) {
    invalid("A reconciliation-required Import Receipt needs a reconciliation reference.");
  }
  if (batch) {
    if (envelope.tenantId !== batch.tenantId) tenantMismatch("Import Receipt tenant must match its batch.");
    if (envelope.batchId !== batch.batchId) mismatch("Import Receipt must close the exact batch.");
    if (counts.total !== batch.stagedCounts.records + batch.stagedCounts.rejected) {
      mismatch("Import Receipt total must match all staged and rejected source records.");
    }
  }
  return envelope as ImportReceiptV1;
}

export function parseConnectorBindingV1(value: unknown): ConnectorBindingV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.connectorBinding, [
    "bindingId", "consentRef", "contractVersion", "credentialReference", "cursor", "provider",
    "revocation", "scopes", "status", "tenantId",
  ], "connectorBinding");
  uuid(envelope.bindingId, "connectorBinding.bindingId");
  id(envelope.tenantId, "connectorBinding.tenantId");
  id(envelope.consentRef, "connectorBinding.consentRef");
  const credentialReference = id(envelope.credentialReference, "connectorBinding.credentialReference");
  if (!credentialReference.startsWith("secret-ref:")) {
    authority("Connector Binding may contain only a non-secret credential reference.");
  }
  idOrNull(envelope.cursor, "connectorBinding.cursor");
  enumeration(envelope.provider, ["GOOGLE_WORKSPACE", "MICROSOFT_365", "QUICKBOOKS_ONLINE"], "connectorBinding.provider");
  stringArray(envelope.scopes, true, "connectorBinding.scopes");
  const status = enumeration(envelope.status, ["CONSENT_REQUIRED", "DRAFT", "BOUND", "REVOKED"], "connectorBinding.status");
  const revocation = exact(envelope.revocation, ["revocationRef", "revokedAt"], "connectorBinding.revocation");
  idOrNull(revocation.revocationRef, "connectorBinding.revocation.revocationRef");
  timestampOrNull(revocation.revokedAt, "connectorBinding.revocation.revokedAt");
  if (status === "REVOKED" && (revocation.revocationRef === null || revocation.revokedAt === null)) {
    invalid("A revoked Connector Binding requires revocation evidence.");
  }
  if (status !== "REVOKED" && (revocation.revocationRef !== null || revocation.revokedAt !== null)) {
    invalid("Only a revoked Connector Binding may carry revocation evidence.");
  }
  return envelope as ConnectorBindingV1;
}

export function parseSyncReceiptV1(value: unknown, binding?: ConnectorBindingV1): SyncReceiptV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.syncReceipt, [
    "bindingId", "changes", "contractVersion", "cursor", "finality", "providerAcknowledgementRef",
    "reconciliationRef", "sourceReadbackRef", "tenantId",
  ], "syncReceipt");
  uuid(envelope.bindingId, "syncReceipt.bindingId");
  id(envelope.tenantId, "syncReceipt.tenantId");
  const cursor = exact(envelope.cursor, ["after", "before"], "syncReceipt.cursor");
  idOrNull(cursor.before, "syncReceipt.cursor.before");
  idOrNull(cursor.after, "syncReceipt.cursor.after");
  const changes = exact(envelope.changes, ["created", "duplicates", "failed", "updated"], "syncReceipt.changes");
  for (const key of ["created", "duplicates", "failed", "updated"] as const) {
    nonNegativeInteger(changes[key], `syncReceipt.changes.${key}`);
  }
  const finality = enumeration(envelope.finality, ["ACKNOWLEDGED", "RECONCILING", "SOURCE_CONFIRMED"], "syncReceipt.finality");
  idOrNull(envelope.providerAcknowledgementRef, "syncReceipt.providerAcknowledgementRef");
  idOrNull(envelope.reconciliationRef, "syncReceipt.reconciliationRef");
  idOrNull(envelope.sourceReadbackRef, "syncReceipt.sourceReadbackRef");
  if (finality === "SOURCE_CONFIRMED" && envelope.sourceReadbackRef === null) {
    finalityError("SOURCE_CONFIRMED synchronization requires authoritative source readback.");
  }
  if (finality === "ACKNOWLEDGED" && envelope.providerAcknowledgementRef === null) {
    finalityError("ACKNOWLEDGED synchronization requires a provider acknowledgement reference.");
  }
  if (finality === "RECONCILING" && envelope.reconciliationRef === null) {
    finalityError("RECONCILING synchronization requires reconciliation evidence.");
  }
  if (binding) {
    if (envelope.tenantId !== binding.tenantId) tenantMismatch("Sync Receipt tenant must match its Connector Binding.");
    if (envelope.bindingId !== binding.bindingId) mismatch("Sync Receipt must close the exact Connector Binding.");
    if (binding.status === "REVOKED") authority("A revoked Connector Binding cannot produce a new Sync Receipt.");
  }
  return envelope as SyncReceiptV1;
}

export function parseSupportCaseV1(value: unknown): SupportCaseV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.supportCase, [
    "actor", "auditHead", "caseId", "contractVersion", "entitlement", "evidenceRefs",
    "objectVersion", "ownerRole", "severity", "sla", "source", "staleAfter", "status", "tenantId",
  ], "supportCase");
  parseSupportActor(envelope.actor, "supportCase.actor");
  parseSupportAuditHead(envelope.auditHead, "supportCase.auditHead");
  uuid(envelope.caseId, "supportCase.caseId");
  id(envelope.tenantId, "supportCase.tenantId");
  id(envelope.objectVersion, "supportCase.objectVersion");
  id(envelope.ownerRole, "supportCase.ownerRole");
  stringArray(envelope.evidenceRefs, false, "supportCase.evidenceRefs");
  enumeration(envelope.severity, ["P0", "P1", "P2", "P3"], "supportCase.severity");
  enumeration(envelope.source, ["CHAT", "EMAIL", "FORM", "IN_APP"], "supportCase.source");
  const entitlement = exact(envelope.entitlement, [
    "entitlementRef", "policyVersion", "state", "verifiedAt",
  ], "supportCase.entitlement");
  id(entitlement.entitlementRef, "supportCase.entitlement.entitlementRef");
  id(entitlement.policyVersion, "supportCase.entitlement.policyVersion");
  const entitlementState = enumeration(entitlement.state, [
    "ACTIVE", "REVOKED", "UNVERIFIED",
  ], "supportCase.entitlement.state");
  timestamp(entitlement.verifiedAt, "supportCase.entitlement.verifiedAt");
  if (entitlementState !== "ACTIVE") authority("Support access requires an active, verified entitlement.");
  const status = enumeration(envelope.status, [
    "CLOSED_VERIFIED", "INVESTIGATING", "OPEN", "PENDING_CUSTOMER", "PENDING_HUMAN",
  ], "supportCase.status");
  const sla = exact(envelope.sla, [
    "dueAt", "pauseReason", "pausedAt", "policyVersion", "startedAt", "state",
  ], "supportCase.sla");
  const startedAt = timestamp(sla.startedAt, "supportCase.sla.startedAt");
  const dueAt = timestamp(sla.dueAt, "supportCase.sla.dueAt");
  id(sla.policyVersion, "supportCase.sla.policyVersion");
  if (Date.parse(dueAt) <= Date.parse(startedAt)) invalid("Support SLA dueAt must follow startedAt.");
  const slaState = enumeration(sla.state, ["CLOCK_STOPPED", "PAUSED", "RUNNING"], "supportCase.sla.state");
  const pauseReason = enumeration(sla.pauseReason, [
    "APPROVED_EXCEPTION", "CUSTOMER_WAITING", "NONE",
  ], "supportCase.sla.pauseReason");
  timestampOrNull(sla.pausedAt, "supportCase.sla.pausedAt");
  if (slaState === "PAUSED" && (sla.pausedAt === null || pauseReason === "NONE")) {
    authority("A paused SLA requires an allowed pause reason and pausedAt evidence.");
  }
  if (slaState !== "PAUSED" && (sla.pausedAt !== null || pauseReason !== "NONE")) {
    authority("Only a paused SLA may carry pause evidence.");
  }
  if (status === "CLOSED_VERIFIED" && (envelope.evidenceRefs as unknown[]).length === 0) {
    finalityError("A support case may close only with verification evidence.");
  }
  if (status === "CLOSED_VERIFIED" && slaState !== "CLOCK_STOPPED") {
    finalityError("A verified closed case must stop its SLA clock.");
  }
  const staleAfter = timestamp(envelope.staleAfter, "supportCase.staleAfter");
  if (Date.parse(staleAfter) <= Date.now()) expired("Support Case evidence is stale.");
  return envelope as SupportCaseV1;
}

export function parseSupportActionV1(
  value: unknown,
  supportCase?: SupportCaseV1,
  priorAction?: SupportActionV1,
): SupportActionV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.supportAction, [
    "actionId", "actionType", "actor", "ambiguity", "auditHead", "caseId", "caseVersion",
    "contractVersion", "effectMode", "evidenceRefs", "finality", "operation", "policy", "replay",
    "reservation", "resultReadbackRef", "severityChange", "status", "tenantId",
  ], "supportAction");
  uuid(envelope.actionId, "supportAction.actionId");
  uuid(envelope.caseId, "supportAction.caseId");
  id(envelope.tenantId, "supportAction.tenantId");
  const actionActor = parseSupportActor(envelope.actor, "supportAction.actor");
  const auditHead = parseSupportAuditHead(envelope.auditHead, "supportAction.auditHead");
  enumeration(envelope.actionType, ["CONFIGURATION", "DIAGNOSTIC", "ESCALATION", "REPLY_DRAFT", "SYNC_RETRY"], "supportAction.actionType");
  const effectMode = enumeration(envelope.effectMode, CORE_EFFECT_MODES, "supportAction.effectMode");
  const ambiguity = enumeration(envelope.ambiguity, ["CLEAR", "INDETERMINATE"], "supportAction.ambiguity");
  const status = enumeration(envelope.status, ["APPROVED", "COMPLETED_VERIFIED", "PROPOSED", "REJECTED"], "supportAction.status");
  const finality = enumeration(envelope.finality, [
    "NOT_FINAL", "OWNER_COMMITTED", "SOURCE_CONFIRMED",
  ], "supportAction.finality");
  idOrNull(envelope.resultReadbackRef, "supportAction.resultReadbackRef");
  stringArray(envelope.evidenceRefs, true, "supportAction.evidenceRefs");
  const caseVersion = exact(envelope.caseVersion, ["expected", "observed"], "supportAction.caseVersion");
  id(caseVersion.expected, "supportAction.caseVersion.expected");
  id(caseVersion.observed, "supportAction.caseVersion.observed");
  if (caseVersion.expected !== caseVersion.observed) expired("Support Action was prepared against a stale case version.");
  const operation = parseSultanOperationV1(envelope.operation);
  if (operation.effectMode !== effectMode || operation.a02Command.context.tenant.tenantId !== envelope.tenantId
    || operation.a02Command.target.objectId !== envelope.caseId
    || operation.a02Command.expectedObjectVersion !== caseVersion.expected) {
    mismatch("Support Action must be a lossless tenant/case/version projection of its Sultan Operation.");
  }
  if (operation.a02Command.context.logicalActor?.actorId !== actionActor.logicalActorId
    || operation.a02Command.context.request.requestId !== actionActor.serverDerivedIdentityRef) {
    authority("Support Action actor must be derived from the exact A02 logical actor and request identity.");
  }
  const policy = parseSupportPolicyDecision(envelope.policy, "supportAction.policy");
  const replayBoundary = parseSupportReplay(envelope.replay, "supportAction.replay");
  if (replayBoundary.payloadHash !== operation.a02Command.payloadHash) {
    replay("Support Action replay hash must equal the canonical Sultan Operation payload hash.");
  }
  const reservation = parseSupportReservation(envelope.reservation, "supportAction.reservation");
  if (effectMode !== "NO_EFFECT" && status !== "REJECTED") {
    if (policy.decision === "DENY") authority("Denied policy cannot authorize an effectful Support Action.");
    if (policy.decision === "REQUIRE_HUMAN" && policy.approvalRef === null) {
      authority("An effectful Support Action requiring a human needs approval evidence.");
    }
    if (reservation.state !== "RESERVED") authority("An effectful Support Action must be reserved before dispatch.");
  }
  if (status === "COMPLETED_VERIFIED" && envelope.resultReadbackRef === null) {
    finalityError("A completed Support Action requires authoritative verification readback.");
  }
  if (finality === "SOURCE_CONFIRMED" && (status !== "COMPLETED_VERIFIED" || envelope.resultReadbackRef === null)) {
    finalityError("SOURCE_CONFIRMED Support Action finality requires a verified completion and readback.");
  }
  if (ambiguity === "INDETERMINATE" && finality !== "NOT_FINAL") {
    finalityError("An indeterminate Support Action cannot claim finality.");
  }
  if (envelope.severityChange !== null) {
    const change = exact(envelope.severityChange, ["approvalRef", "from", "to"], "supportAction.severityChange");
    const from = enumeration(change.from, ["P0", "P1", "P2", "P3"], "supportAction.severityChange.from");
    const to = enumeration(change.to, ["P0", "P1", "P2", "P3"], "supportAction.severityChange.to");
    idOrNull(change.approvalRef, "supportAction.severityChange.approvalRef");
    if (from === to) invalid("Support severity change must change severity.");
    if (severityRank(to) > severityRank(from) && change.approvalRef === null) {
      authority("A support severity decrease requires explicit approval evidence.");
    }
  }
  if (supportCase) {
    if (envelope.tenantId !== supportCase.tenantId) tenantMismatch("Support Action tenant must match its case.");
    if (envelope.caseId !== supportCase.caseId) mismatch("Support Action must reference the exact Support Case.");
    if (caseVersion.observed !== supportCase.objectVersion) expired("Support Action observed case version is stale.");
    if (actionActor.logicalActorId !== supportCase.actor.logicalActorId
      || actionActor.serverDerivedIdentityRef !== supportCase.actor.serverDerivedIdentityRef) {
      authority("Support Action actor must match the server-derived Support Case actor boundary.");
    }
    const caseAudit = supportCase.auditHead;
    if (auditHead.sequence !== caseAudit.sequence + 1 || auditHead.previousEntryDigest !== caseAudit.entryDigest) {
      mismatch("Support Action audit entry must append exactly to the Support Case audit head.");
    }
  }
  if (priorAction && replayBoundary.idempotencyKey === priorAction.replay.idempotencyKey) {
    if (replayBoundary.payloadHash !== priorAction.replay.payloadHash) replay("Changed payload reused a Support Action idempotency key.");
    if (envelope.actionId !== priorAction.actionId && replayBoundary.replayOfId !== priorAction.actionId) {
      replay("An exact Support Action replay must identify the original action.");
    }
  }
  return envelope as SupportActionV1;
}

export function parseCustomerReplyV1(
  value: unknown,
  supportCase?: SupportCaseV1,
  supportAction?: SupportActionV1,
  priorReply?: CustomerReplyV1,
): CustomerReplyV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.customerReply, [
    "actionId", "actor", "approval", "auditHead", "caseId", "caseVersion", "contentDigest",
    "contractVersion", "delivery", "finality", "followUpAt", "replay", "reservation",
    "replyId", "tenantId", "truthSourceRefs",
  ], "customerReply");
  uuid(envelope.actionId, "customerReply.actionId");
  uuid(envelope.replyId, "customerReply.replyId");
  uuid(envelope.caseId, "customerReply.caseId");
  id(envelope.tenantId, "customerReply.tenantId");
  id(envelope.caseVersion, "customerReply.caseVersion");
  const replyActor = parseSupportActor(envelope.actor, "customerReply.actor");
  const auditHead = parseSupportAuditHead(envelope.auditHead, "customerReply.auditHead");
  digest(envelope.contentDigest, "customerReply.contentDigest");
  stringArray(envelope.truthSourceRefs, true, "customerReply.truthSourceRefs");
  timestampOrNull(envelope.followUpAt, "customerReply.followUpAt");
  const approval = parseSupportPolicyDecision(envelope.approval, "customerReply.approval");
  const replayBoundary = parseSupportReplay(envelope.replay, "customerReply.replay");
  if (replayBoundary.payloadHash !== envelope.contentDigest) replay("Customer Reply replay hash must equal contentDigest.");
  const reservation = parseSupportReservation(envelope.reservation, "customerReply.reservation");
  const delivery = exact(envelope.delivery, [
    "deliveredAt", "providerReceiptRef", "readbackRef", "state",
  ], "customerReply.delivery");
  const deliveryState = enumeration(delivery.state, ["DRAFT", "FAILED", "SENT_VERIFIED"], "customerReply.delivery.state");
  timestampOrNull(delivery.deliveredAt, "customerReply.delivery.deliveredAt");
  idOrNull(delivery.providerReceiptRef, "customerReply.delivery.providerReceiptRef");
  idOrNull(delivery.readbackRef, "customerReply.delivery.readbackRef");
  const finality = enumeration(envelope.finality, ["NOT_FINAL", "SOURCE_CONFIRMED"], "customerReply.finality");
  if (deliveryState === "SENT_VERIFIED") {
    if (approval.decision === "DENY" || (approval.decision === "REQUIRE_HUMAN" && approval.approvalRef === null)) {
      authority("Customer Reply delivery requires an allowed policy decision or named human approval.");
    }
    if (reservation.state !== "RESERVED") authority("Customer Reply delivery must be reserved before communication.");
    if (delivery.deliveredAt === null || delivery.providerReceiptRef === null || delivery.readbackRef === null) {
      finalityError("A sent Customer Reply requires provider receipt and delivery readback evidence.");
    }
    if (finality !== "SOURCE_CONFIRMED") finalityError("Verified delivery must claim SOURCE_CONFIRMED finality.");
  } else if (finality !== "NOT_FINAL") {
    finalityError("An undelivered Customer Reply cannot claim finality.");
  }
  if (supportCase) {
    if (envelope.tenantId !== supportCase.tenantId) tenantMismatch("Customer Reply tenant must match its case.");
    if (envelope.caseId !== supportCase.caseId) mismatch("Customer Reply must reference the exact Support Case.");
    if (envelope.caseVersion !== supportCase.objectVersion) expired("Customer Reply was drafted from a stale Support Case version.");
    if (replyActor.logicalActorId !== supportCase.actor.logicalActorId
      || replyActor.serverDerivedIdentityRef !== supportCase.actor.serverDerivedIdentityRef) {
      authority("Customer Reply actor must match the server-derived Support Case actor boundary.");
    }
  }
  if (supportAction) {
    if (envelope.actionId !== supportAction.actionId) mismatch("Customer Reply must reference its exact approved Support Action.");
    if (replyActor.logicalActorId !== supportAction.actor.logicalActorId
      || replyActor.serverDerivedIdentityRef !== supportAction.actor.serverDerivedIdentityRef) {
      authority("Customer Reply actor must match the Support Action actor boundary.");
    }
    if (auditHead.sequence !== supportAction.auditHead.sequence + 1
      || auditHead.previousEntryDigest !== supportAction.auditHead.entryDigest) {
      mismatch("Customer Reply audit entry must append exactly to the Support Action audit head.");
    }
  }
  if (priorReply && replayBoundary.idempotencyKey === priorReply.replay.idempotencyKey) {
    if (replayBoundary.payloadHash !== priorReply.replay.payloadHash) replay("Changed reply content reused an idempotency key.");
    if (envelope.replyId !== priorReply.replyId && replayBoundary.replayOfId !== priorReply.replyId) {
      replay("An exact Customer Reply replay must identify the original reply.");
    }
  }
  return envelope as CustomerReplyV1;
}

export function parseLuzioneCoreFeatureFlagsV1(value: unknown): LuzioneCoreFeatureFlagsV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.featureFlags, [
    "contractVersion", "defaultState", "flags", "overrideAuthority",
  ], "featureFlags");
  if (envelope.defaultState !== "DISABLED" || envelope.overrideAuthority !== "G2_HUMAN_GO_REQUIRED") {
    darkFlag("CORE-01 feature flags must remain disabled behind explicit G2 authority.");
  }
  const flags = exact(envelope.flags, [
    "connectorSync", "customerReplyDelivery", "importCommit", "onboardingApply",
    "operationEffects", "providerDispatch", "supportActionEffects",
  ], "featureFlags.flags");
  for (const [name, state] of Object.entries(flags)) {
    if (state !== false) darkFlag(`CORE-01 feature flag ${name} must remain false.`);
  }
  return envelope as LuzioneCoreFeatureFlagsV1;
}

export function parseLuzioneCoreReleaseManifestV1(value: unknown): LuzioneCoreReleaseManifestV1 {
  const envelope = versioned(value, CORE_CONTRACT_VERSIONS.releaseManifest, [
    "a02Pins", "candidateSha", "contractBundleVersion", "contractVersion", "contractVersions",
    "controllerAuthority", "effectAuthority", "featureFlagsVersion", "fepDependency",
    "productionReady", "runtimeActivation",
  ], "releaseManifest");
  parseA02Pins(envelope.a02Pins);
  if (envelope.contractBundleVersion !== CORE_CONTRACT_BUNDLE_VERSION) wrongVersion("releaseManifest.contractBundleVersion", CORE_CONTRACT_BUNDLE_VERSION);
  parseVersionMap(envelope.contractVersions);
  if (envelope.featureFlagsVersion !== CORE_CONTRACT_VERSIONS.featureFlags) wrongVersion("releaseManifest.featureFlagsVersion", CORE_CONTRACT_VERSIONS.featureFlags);
  id(envelope.controllerAuthority, "releaseManifest.controllerAuthority");
  if (envelope.candidateSha !== "UNBOUND_G0") digest40(envelope.candidateSha, "releaseManifest.candidateSha");
  if (envelope.effectAuthority !== "NO_EFFECT" || envelope.runtimeActivation !== "DARK_ONLY"
    || envelope.productionReady !== false || envelope.fepDependency !== false) {
    darkFlag("CORE-01 release manifest must remain dark, NO_EFFECT, not production-ready and independent of FEP.");
  }
  return envelope as LuzioneCoreReleaseManifestV1;
}

export function parseLuzioneCoreContractDocument(value: unknown): LuzioneCoreContractDocument {
  const contractVersion = object(value, "contract").contractVersion;
  switch (contractVersion as CoreContractVersion) {
    case CORE_CONTRACT_VERSIONS.connectorBinding: return parseConnectorBindingV1(value);
    case CORE_CONTRACT_VERSIONS.customerReply: return parseCustomerReplyV1(value);
    case CORE_CONTRACT_VERSIONS.featureFlags: return parseLuzioneCoreFeatureFlagsV1(value);
    case CORE_CONTRACT_VERSIONS.importBatch: return parseImportBatchV1(value);
    case CORE_CONTRACT_VERSIONS.importReceipt: return parseImportReceiptV1(value);
    case CORE_CONTRACT_VERSIONS.releaseManifest: return parseLuzioneCoreReleaseManifestV1(value);
    case CORE_CONTRACT_VERSIONS.setupMandate: return parseSetupMandateV1(value);
    case CORE_CONTRACT_VERSIONS.supportAction: return parseSupportActionV1(value);
    case CORE_CONTRACT_VERSIONS.supportCase: return parseSupportCaseV1(value);
    case CORE_CONTRACT_VERSIONS.syncReceipt: return parseSyncReceiptV1(value);
    case CORE_CONTRACT_VERSIONS.tenantBlueprint: return parseTenantBlueprintV1(value);
    default:
      if (Object.values(SEED_PRODUCT_CONTRACT_VERSIONS).includes(contractVersion as never)) {
        return parseLuzioneSeedProductContractDocument(value);
      }
      wrongVersion("contract.contractVersion", Object.values(CORE_CONTRACT_VERSIONS).join(" | "));
  }
}

function parseA02Pins(value: unknown) {
  const pins = exact(value, ["bundle", "command", "identityTenant", "readback", "receipt"], "a02Pins");
  for (const [key, expected] of Object.entries(CORE_A02_PINS)) {
    if (pins[key] !== expected) wrongVersion(`a02Pins.${key}`, expected);
  }
}

function parseVersionMap(value: unknown) {
  const keys = Object.keys(CORE_CONTRACT_VERSIONS).sort();
  const versions = exact(value, keys, "contractVersions");
  for (const [key, expected] of Object.entries(CORE_CONTRACT_VERSIONS)) {
    if (versions[key] !== expected) wrongVersion(`contractVersions.${key}`, expected);
  }
}

function parseSupportActor(value: unknown, path: string) {
  const actor = exact(value, ["logicalActorId", "membershipState", "serverDerivedIdentityRef"], path);
  id(actor.logicalActorId, `${path}.logicalActorId`);
  id(actor.serverDerivedIdentityRef, `${path}.serverDerivedIdentityRef`);
  const membershipState = enumeration(actor.membershipState, ["ACTIVE", "REVOKED"], `${path}.membershipState`);
  if (membershipState !== "ACTIVE") authority(`${path} requires active tenant membership.`);
  return actor;
}

function parseSupportAuditHead(value: unknown, path: string) {
  const audit = exact(value, ["entryDigest", "entryId", "previousEntryDigest", "sequence"], path);
  digest(audit.entryDigest, `${path}.entryDigest`);
  uuid(audit.entryId, `${path}.entryId`);
  if (audit.previousEntryDigest !== null) digest(audit.previousEntryDigest, `${path}.previousEntryDigest`);
  positiveInteger(audit.sequence, `${path}.sequence`);
  if (audit.sequence === 1 && audit.previousEntryDigest !== null) mismatch(`${path} first entry cannot name a predecessor.`);
  if (Number(audit.sequence) > 1 && audit.previousEntryDigest === null) mismatch(`${path} append entry requires a predecessor digest.`);
  return audit;
}

function parseSupportPolicyDecision(value: unknown, path: string) {
  const policy = exact(value, ["approvalRef", "decision", "evaluatedAt", "policyVersion", "reasonCodes"], path);
  idOrNull(policy.approvalRef, `${path}.approvalRef`);
  const decision = enumeration(policy.decision, ["ALLOW", "DENY", "REQUIRE_HUMAN"], `${path}.decision`);
  timestamp(policy.evaluatedAt, `${path}.evaluatedAt`);
  id(policy.policyVersion, `${path}.policyVersion`);
  stringArray(policy.reasonCodes, true, `${path}.reasonCodes`);
  if (decision === "REQUIRE_HUMAN" && policy.approvalRef === null) {
    authority(`${path} REQUIRE_HUMAN decision needs named approval evidence before execution.`);
  }
  if (decision === "DENY" && policy.approvalRef !== null) {
    invalid(`${path} denied decision cannot claim approval evidence.`);
  }
  return { approvalRef: policy.approvalRef, decision };
}

function parseSupportReplay(value: unknown, path: string) {
  const replayBoundary = exact(value, ["idempotencyKey", "payloadHash", "replayOfId"], path);
  id(replayBoundary.idempotencyKey, `${path}.idempotencyKey`);
  digest(replayBoundary.payloadHash, `${path}.payloadHash`);
  if (replayBoundary.replayOfId !== null) uuid(replayBoundary.replayOfId, `${path}.replayOfId`);
  return replayBoundary;
}

function parseSupportReservation(value: unknown, path: string) {
  const reservation = exact(value, ["receiptRef", "state"], path);
  idOrNull(reservation.receiptRef, `${path}.receiptRef`);
  const state = enumeration(reservation.state, [
    "CONFLICT", "INDETERMINATE", "NOT_RESERVED_G0", "RESERVED",
  ], `${path}.state`);
  if (state === "RESERVED" && reservation.receiptRef === null) mismatch(`${path} RESERVED state requires a receipt.`);
  if (state !== "RESERVED" && reservation.receiptRef !== null) mismatch(`${path} unreserved state cannot claim a receipt.`);
  return { receiptRef: reservation.receiptRef, state };
}

function severityRank(value: string) {
  return ["P0", "P1", "P2", "P3"].indexOf(value);
}

function versioned(value: unknown, expectedVersion: string, keys: readonly string[], path: string): JsonObject {
  const result = exact(value, keys, path);
  if (result.contractVersion !== expectedVersion) wrongVersion(`${path}.contractVersion`, expectedVersion);
  return result;
}

function exact(value: unknown, keys: readonly string[], path: string): JsonObject {
  const result = object(value, path);
  const expected = [...keys].sort();
  const actual = Object.keys(result).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("CORE_FIELD_SET_MISMATCH", `${path} fields must be exactly ${expected.join(", ")}; received ${actual.join(", ")}.`);
  }
  return result;
}

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${path} must be an object.`);
  return value as JsonObject;
}

function id(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length < 2 || value.length > 512) invalid(`${path} must be a bounded identifier.`);
  return value;
}

function idOrNull(value: unknown, path: string) {
  if (value !== null) id(value, path);
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    invalid(`${path} must be a UUID.`);
  }
  return value;
}

function digest(value: unknown, path: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid(`${path} must be a lowercase SHA-256 digest.`);
}

function digest40(value: unknown, path: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) invalid(`${path} must be an exact Git SHA.`);
}

function timestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(`${path} must be an ISO timestamp.`);
  return value;
}

function timestampOrNull(value: unknown, path: string) {
  if (value !== null) timestamp(value, path);
}

function boolean(value: unknown, path: string) {
  if (typeof value !== "boolean") invalid(`${path} must be boolean.`);
}

function nonNegativeInteger(value: unknown, path: string) {
  if (!Number.isInteger(value) || Number(value) < 0) invalid(`${path} must be a non-negative integer.`);
}

function positiveInteger(value: unknown, path: string) {
  if (!Number.isInteger(value) || Number(value) <= 0) invalid(`${path} must be a positive integer.`);
}

function stringArray(value: unknown, requireOne: boolean, path: string): string[] {
  if (!Array.isArray(value) || (requireOne && value.length === 0)) invalid(`${path} must be a string array${requireOne ? " with at least one item" : ""}.`);
  const result = value.map((item, index) => id(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) invalid(`${path} values must be unique.`);
  return result;
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(`${path} is not an allowed value.`);
  return value as T;
}

function invalid(message: string): never { return fail("CORE_VALUE_INVALID", message); }
function authority(message: string): never { return fail("CORE_AUTHORITY_DENIED", message); }
function darkFlag(message: string): never { return fail("CORE_DARK_FLAG_REQUIRED", message); }
function expired(message: string): never { return fail("CORE_EXPIRED", message); }
function finalityError(message: string): never { return fail("CORE_FINALITY_INVALID", message); }
function mismatch(message: string): never { return fail("CORE_REFERENCE_MISMATCH", message); }
function replay(message: string): never { return fail("CORE_REPLAY_CONFLICT", message); }
function tenantMismatch(message: string): never { return fail("CORE_TENANT_MISMATCH", message); }
function wrongVersion(path: string, expected: string): never { return fail("CORE_WRONG_VERSION", `${path} must be ${expected}.`); }
function fail(code: LuzioneCoreCompatibilityErrorCode, message: string): never {
  throw new LuzioneCoreCompatibilityError(code, message);
}
