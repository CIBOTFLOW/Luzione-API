import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import { PostgresAtomicCommandStore, type CommandTransaction } from "@/lib/platform-guarantees/postgresCommandStore";
import type { AcceptedCommandWrite } from "@/modules/platform-guarantees/commandKernel";
import type { LifecycleCommandRequest } from "@/modules/platform-guarantees/types";
import { SEED_PRODUCT_CONTRACT_VERSIONS, type TimelineEventV1 } from "@/modules/luzione-core-contracts/seedProductContracts";
import { parseTimelineEventV1 } from "@/modules/luzione-core-contracts/seedProductConsumerSdk";
import type { SeedAuthorityBoundaryV1, SeedMutationBoundaryV1, SeedReceiptReadbackV1, SeedSourceRefV1 } from "@/modules/luzione-core-contracts/seedProductContracts";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { createLifecycleCommandRequest, IdempotencyConflictError, LifecycleCommandKernel } from "@/modules/platform-guarantees/commandKernel";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  SUPPLIER_PROFILE_CONTRACT_VERSION,
  SUPPLIER_PROFILE_OWNER,
  SUPPLIER_PROFILE_POLICY_VERSION,
  parseSeedSupplierIdentityCommand,
  parseSupplierProfileV1,
  type SeedSupplierIdentityCommand,
  type SupplierCapability,
  type SupplierProfileFacts,
  type SupplierProfileRefInput,
  type SupplierProfileStatus,
  type SupplierProfileTransitionCommand,
  type SupplierProfileV1,
} from "@/modules/seed-supplier-identity/contracts";
import {
  accountVersionRef,
  isCanonicalSupplierIdentityInstant,
  nextSupplierProfileStatus,
  supplierEligibilityDefects,
  supplierProfileIdFor,
  supplierProfileVersion,
} from "@/modules/seed-supplier-identity/model";

type Row = Record<string, unknown>;
type Hooks = { afterOwnerWrite?: (client: PoolClient) => Promise<void> };

const RECEIPT_COLUMNS = `r.receipt_id, r.idempotency_key, r.payload_hash,
  r.policy_version, r.actor_id, r.actor_type,
  r.correlation_id, r.committed_object_version, r.committed_at, r.command_id,
  r.command_type, r.target_owner_project, r.target_object_type, r.target_object_id,
  r.requested_at, r.state receipt_state`;

export class SeedSupplierIdentityDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly recovery?: { committedObjectVersion: string; receiptId: string; retry: "RECONCILE_FIRST" },
  ) {
    super(message);
    this.name = "SeedSupplierIdentityDomainError";
  }
}

export class SupplierIdentityAtomicCommandStore extends PostgresAtomicCommandStore {
  async insertAccepted(transaction: CommandTransaction, write: AcceptedCommandWrite, request: LifecycleCommandRequest) {
    write.receipt.state = "DOMAIN_COMMITTED";
    await super.insertAccepted(transaction, write, request);
  }
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}
function iso(value: unknown) {
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new SeedSupplierIdentityDomainError("CANONICAL_READBACK_CORRUPT", "Supplier Profile row has an invalid timestamp.", 500);
  return new Date(parsed).toISOString();
}
function actorType(value: unknown): SeedAuthorityBoundaryV1["actorType"] {
  return value === "user" ? "HUMAN" : value === "agent" ? "SULTAN_AGENT" : "SERVICE";
}
function sourceRef(tenantId: string, ref: SupplierProfileRefInput): SeedSourceRefV1 {
  return { ...ref, tenantId };
}
function sameJson(left: unknown, right: unknown) {
  return sha256(left) === sha256(right);
}
function statusFromRow(value: unknown): SupplierProfileStatus {
  const status = String(value);
  if (!["ARCHIVED", "ELIGIBLE", "EXPIRED", "PROPOSED", "REVOKED", "SUSPENDED"].includes(status)) {
    throw new SeedSupplierIdentityDomainError("CANONICAL_READBACK_CORRUPT", "Supplier Profile has an unsupported status.", 500);
  }
  return status as SupplierProfileStatus;
}
function boundaries(row: Row, committedVersion: string) {
  const mutation: SeedMutationBoundaryV1 = {
    expectedVersion: String(row.expected_object_version),
    idempotencyKey: String(row.idempotency_key),
    payloadHash: String(row.payload_hash),
  };
  const approvalRef = row.human_authentication_ref ? `approval:${sha256({ authenticationRef: String(row.human_authentication_ref), commandId: String(row.created_command_id) })}` : null;
  const authority: SeedAuthorityBoundaryV1 = {
    actorId: String(row.actor_id),
    actorType: actorType(row.actor_type),
    approvalRef,
    capability: String(row.command_type),
    decision: approvalRef ? "REQUIRE_HUMAN" : "ALLOW",
    effectClass: approvalRef ? "A2" : "A1",
    policyVersion: String(row.policy_version),
    serverDerivedIdentityRef: `correlation:${String(row.correlation_id)}`,
  };
  const receipt: SeedReceiptReadbackV1 = {
    committedVersion,
    finality: "DOMAIN_COMMITTED",
    observedAt: null,
    observedVersion: null,
    providerAcknowledgementRef: null,
    receiptId: String(row.receipt_id),
    sourceReadbackRef: null,
  };
  return { authority, mutation, receipt };
}

function profileFromRow(row: Row, observedAt: string): SupplierProfileV1 {
  const tenantId = String(row.tenant_id);
  const profileId = String(row.supplier_profile_id);
  const versionNumber = Number(row.version);
  const objectVersion = String(row.object_version);
  const expectedObjectVersion = supplierProfileVersion(profileId, versionNumber);
  const accountId = String(row.account_id);
  const accountVersion = String(row.account_version);
  const actualAccountVersion = accountVersionRef(accountId, row.current_account_version);
  const data = json<SupplierProfileV1["data"]>(row.canonical_payload);
  const command = parseSeedSupplierIdentityCommand(json(row.command_payload));
  const defects: string[] = [];
  if (objectVersion !== expectedObjectVersion) defects.push("PROFILE_VERSION_MISMATCH");
  if (profileId !== supplierProfileIdFor(tenantId, accountId)) defects.push("PROFILE_STABLE_ID_MISMATCH");
  if (data.accountRef.accountId !== accountId || data.accountRef.accountVersion !== accountVersion) defects.push("ACCOUNT_PAYLOAD_LINK_MISMATCH");
  if (actualAccountVersion !== accountVersion) defects.push("ACCOUNT_VERSION_STALE");
  if (!sameJson(data.capabilities, json(row.capabilities))) defects.push("CAPABILITIES_PAYLOAD_MISMATCH");
  if (!sameJson(data.approvedCategories, json(row.approved_categories))) defects.push("CATEGORIES_PAYLOAD_MISMATCH");
  if (!sameJson(data.approvedRegions, json(row.approved_regions))) defects.push("REGIONS_PAYLOAD_MISMATCH");
  if (!sameJson(data.contactRefs, json(row.contact_refs))) defects.push("CONTACTS_PAYLOAD_MISMATCH");
  if (!sameJson(data.evidenceRefs, json(row.evidence_refs))) defects.push("EVIDENCE_PAYLOAD_MISMATCH");
  if (!sameJson(data.identityReview.conflictRefs, json(row.identity_conflict_refs)) || !sameJson(data.identityReview.duplicateAccountRefs, json(row.duplicate_account_refs))) defects.push("IDENTITY_REVIEW_PAYLOAD_MISMATCH");
  if (data.validFrom !== iso(row.valid_from) || data.validUntil !== iso(row.valid_until)) defects.push("VALIDITY_PAYLOAD_MISMATCH");
  if (String(row.created_command_id) !== String(row.command_id) || String(row.created_by) !== String(row.actor_id) || String(row.created_by_type) !== String(row.actor_type)) defects.push("RECEIPT_ACTOR_COMMAND_MISMATCH");
  if (String(row.command_payload_hash) !== String(row.payload_hash) || sha256(json(row.command_payload)) !== String(row.command_payload_hash)) defects.push("RECEIPT_PAYLOAD_MISMATCH");
  if (String(row.command_type) !== String(json<Record<string, unknown>>(row.command_payload).commandType)) defects.push("RECEIPT_COMMAND_TYPE_MISMATCH");
  if (String(row.target_owner_project) !== SUPPLIER_PROFILE_OWNER || String(row.target_object_type) !== "supplier_profile" || String(row.target_object_id) !== profileId) defects.push("RECEIPT_TARGET_MISMATCH");
  if (String(row.expected_object_version) !== String(row.receipt_expected_object_version) || String(row.committed_object_version) !== objectVersion) defects.push("RECEIPT_VERSION_MISMATCH");
  if (String(row.receipt_state) !== "DOMAIN_COMMITTED" || String(row.policy_version) !== SUPPLIER_PROFILE_POLICY_VERSION || iso(row.requested_at) !== iso(row.created_at)) defects.push("RECEIPT_FINALITY_POLICY_TIME_MISMATCH");
  if (command.commandId !== String(row.created_command_id) || command.idempotencyKey !== String(row.idempotency_key) || command.expectedVersion !== String(row.expected_object_version)) defects.push("COMMAND_IDENTITY_MISMATCH");
  if (command.commandType === "supplier_profile.propose" || command.commandType === "supplier_profile.revise") {
    if (command.accountId !== accountId || command.accountVersion !== accountVersion || !sameJson(command.profile, factsFromData(data))) defects.push("COMMAND_PROFILE_PAYLOAD_MISMATCH");
  } else if (command.supplierProfileId !== profileId || command.action !== data.decision.action || command.reason !== data.decision.reason
    || command.evidenceRefs.some((ref) => !data.evidenceRefs.some((item) => item.objectId === ref.objectId && item.version === ref.version && item.ownerProject === ref.ownerProject))) defects.push("COMMAND_TRANSITION_PAYLOAD_MISMATCH");
  if (defects.length) throw new SeedSupplierIdentityDomainError("CANONICAL_READBACK_CORRUPT", `Supplier Profile readback failed: ${defects.join(", ")}.`, 500);
  const storedStatus = statusFromRow(row.status);
  const status = storedStatus;
  const sources: SeedSourceRefV1[] = [
    { objectId: accountId, objectType: "ACCOUNT", ownerProject: "LUZIONE_CRM", tenantId, version: accountVersion },
    ...data.contactRefs,
    ...data.evidenceRefs,
  ];
  return parseSupplierProfileV1({
    ...boundaries(row, objectVersion),
    contractVersion: SUPPLIER_PROFILE_CONTRACT_VERSION,
    createdAt: iso(row.profile_created_at),
    data,
    resource: { archivedAt: status === "ARCHIVED" ? iso(row.created_at) : null, id: profileId, status, type: "SUPPLIER_PROFILE", version: objectVersion },
    sourceRefs: sources,
    tenantId,
    updatedAt: iso(row.created_at),
  });
}

function timelineFromRow(row: Row, profile: SupplierProfileV1): TimelineEventV1 {
  const eventId = String(row.event_id);
  const version = profile.resource.version;
  const profileRef: SeedSourceRefV1 = { objectId: profile.resource.id, objectType: "SUPPLIER_PROFILE", ownerProject: SUPPLIER_PROFILE_OWNER, tenantId: profile.tenantId, version: profile.resource.version };
  return parseTimelineEventV1({
    ...boundaries(row, version),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.timelineEvent,
    createdAt: iso(row.recorded_at),
    data: {
      actorId: String(row.actor_id),
      aggregateRefs: [profileRef],
      eventType: String(row.command_type).toUpperCase().replaceAll(".", "_"),
      evidenceRefs: json<string[]>(row.event_evidence_refs),
      occurredAt: iso(row.occurred_at),
      recordedAt: iso(row.recorded_at),
      summary: `Accepted ${String(row.command_type)} with durable Supplier Profile owner commit ${profile.resource.version}.`,
      visibility: "INTERNAL",
    },
    resource: { archivedAt: null, id: eventId, status: "ACTIVE", type: "TIMELINE_EVENT", version },
    sourceRefs: [profileRef],
    tenantId: profile.tenantId,
    updatedAt: iso(row.recorded_at),
  });
}

async function bindRead(client: PoolClient, tenantId: string) {
  await client.query("begin read only");
  await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
}
async function advisory(client: PoolClient, tenantId: string, profileId: string) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2,0))", [tenantId, profileId]);
}

const PROFILE_READ_QUERY = `select p.*, a.version current_account_version,
  ${RECEIPT_COLUMNS}, r.expected_object_version receipt_expected_object_version,
  (select min(origin.created_at) from public.seed_supplier_profile_versions origin
    where origin.tenant_id=p.tenant_id and origin.supplier_profile_id=p.supplier_profile_id) profile_created_at
from public.seed_supplier_profile_versions p
join public.accounts a on a.tenant_id=p.tenant_id and a.id::text=p.account_id
join public.p110_command_receipts r on r.tenant_id=p.tenant_id and r.command_id=p.created_command_id`;

async function exactEvidence(client: PoolClient, tenantId: string, refs: readonly SupplierProfileRefInput[]) {
  for (const ref of refs) {
    if (ref.ownerProject !== "LUZIONE_PROCUREMENT") {
      throw new SeedSupplierIdentityDomainError("EVIDENCE_OWNER_UNSUPPORTED", "Supplier eligibility evidence must use the API-owned procurement Evidence Artifact boundary.", 409);
    }
    const result = await client.query("select object_version,status from public.seed_procurement_evidence_artifacts where tenant_id=$1 and artifact_id=$2 limit 1", [tenantId, ref.objectId]);
    if (!result.rows[0]) throw new SeedSupplierIdentityDomainError("EVIDENCE_NOT_FOUND", "Supplier eligibility evidence is not tenant-visible.", 404);
    if (String(result.rows[0].object_version) !== ref.version) throw new SeedSupplierIdentityDomainError("VERSION_CONFLICT", "Supplier eligibility evidence version is stale.", 409);
    if (String(result.rows[0].status) !== "ACTIVE") throw new SeedSupplierIdentityDomainError("EVIDENCE_NOT_ACTIVE", "Supplier eligibility evidence must be active and reviewed.", 409);
  }
}

async function exactContacts(client: PoolClient, tenantId: string, refs: readonly SupplierProfileRefInput[]) {
  for (const ref of refs) {
    if (ref.ownerProject !== "LUZIONE_CRM") throw new SeedSupplierIdentityDomainError("CONTACT_OWNER_UNSUPPORTED", "Supplier contact references must use canonical CRM Contacts.", 409);
    try {
      const result = await client.query("select version from public.contacts where tenant_id=$1 and id::text=$2 limit 1", [tenantId, ref.objectId]);
      if (!result.rows[0]) throw new SeedSupplierIdentityDomainError("CONTACT_NOT_FOUND", "Supplier contact is not tenant-visible.", 404);
      if (`contact:${ref.objectId}:v${String(result.rows[0].version)}` !== ref.version) throw new SeedSupplierIdentityDomainError("VERSION_CONFLICT", "Supplier contact version is stale.", 409);
    } catch (error) {
      if (error instanceof SeedSupplierIdentityDomainError) throw error;
      if (error instanceof Error && /relation .*contacts.* does not exist/i.test(error.message)) throw new SeedSupplierIdentityDomainError("CONTACT_SOURCE_UNAVAILABLE", "Canonical Contact source is unavailable.", 503);
      throw error;
    }
  }
}

async function exactAccount(client: PoolClient, tenantId: string, accountId: string, expectedVersion: string) {
  try {
    const result = await client.query("select id::text,version from public.accounts where tenant_id=$1 and id::text=$2 limit 1", [tenantId, accountId]);
    if (!result.rows[0]) throw new SeedSupplierIdentityDomainError("SUPPLIER_ACCOUNT_NOT_FOUND", "Canonical Account is not tenant-visible.", 404);
    const actual = accountVersionRef(accountId, result.rows[0].version);
    if (actual !== expectedVersion) throw new SeedSupplierIdentityDomainError("ACCOUNT_VERSION_CONFLICT", "Supplier Profile must bind the current exact Account version.", 409);
    return actual;
  } catch (error) {
    if (error instanceof SeedSupplierIdentityDomainError) throw error;
    if (error instanceof Error && /relation .*accounts.* does not exist/i.test(error.message)) throw new SeedSupplierIdentityDomainError("SUPPLIER_ACCOUNT_SOURCE_UNAVAILABLE", "Canonical Account source is unavailable.", 503);
    throw error;
  }
}

function tenantRefs(tenantId: string, refs: readonly SupplierProfileRefInput[]) {
  return refs.map((ref) => sourceRef(tenantId, ref));
}

function profileData(input: {
  accountId: string;
  accountVersion: string;
  action: SupplierProfileV1["data"]["decision"]["action"];
  facts: SupplierProfileFacts;
  human: HumanApprovalSubject | null;
  reason: string | null;
  requestedAt: string;
  tenantId: string;
}): SupplierProfileV1["data"] {
  return {
    accountRef: { accountId: input.accountId, accountVersion: input.accountVersion },
    approvedCategories: input.facts.approvedCategories,
    approvedRegions: input.facts.approvedRegions,
    capabilities: input.facts.capabilities,
    contactRefs: tenantRefs(input.tenantId, input.facts.contactRefs),
    decision: { action: input.action, decidedAt: input.requestedAt, humanActorId: input.human?.actorId ?? null, humanAuthenticationRef: input.human?.authenticationRef ?? null, reason: input.reason },
    evidenceRefs: tenantRefs(input.tenantId, input.facts.evidenceRefs),
    identityReview: input.facts.identityReview,
    provenanceRefs: input.facts.provenanceRefs,
    validFrom: input.facts.validFrom,
    validUntil: input.facts.validUntil,
  };
}

function factsFromData(data: SupplierProfileV1["data"], appendedEvidence: readonly SupplierProfileRefInput[] = []): SupplierProfileFacts {
  const evidence = [...data.evidenceRefs.map(({ tenantId: _tenantId, ...ref }) => ref as SupplierProfileRefInput), ...appendedEvidence];
  const unique = new Map(evidence.map((ref) => [`${ref.ownerProject}:${ref.objectId}@${ref.version}`, ref]));
  return {
    approvedCategories: data.approvedCategories,
    approvedRegions: data.approvedRegions,
    capabilities: data.capabilities,
    contactRefs: data.contactRefs.map(({ tenantId: _tenantId, ...ref }) => ref as SupplierProfileRefInput),
    evidenceRefs: [...unique.values()],
    identityReview: data.identityReview,
    provenanceRefs: data.provenanceRefs,
    validFrom: data.validFrom,
    validUntil: data.validUntil,
  };
}

export async function requireEligibleSupplier(client: PoolClient, input: {
  accountId: string;
  capability: SupplierCapability;
  observedAt: string;
  tenantId: string;
}) {
  const result = await client.query(`${PROFILE_READ_QUERY}
    where p.tenant_id=$1 and p.account_id=$2
    order by p.version desc limit 1`, [input.tenantId, input.accountId]);
  if (!result.rows[0]) throw new SeedSupplierIdentityDomainError("SUPPLIER_PROFILE_NOT_FOUND", "No canonical Supplier Profile exists for this Account.", 404);
  const row = result.rows[0] as Row;
  const profile = profileFromRow(row, input.observedAt);
  const defects = supplierEligibilityDefects({
    accountVersionActual: accountVersionRef(input.accountId, row.current_account_version),
    accountVersionExpected: profile.data.accountRef.accountVersion,
    capability: input.capability,
    capabilities: profile.data.capabilities,
    observedAt: input.observedAt,
    status: profile.resource.status,
    validFrom: profile.data.validFrom,
    validUntil: profile.data.validUntil,
  });
  if (defects.length) throw new SeedSupplierIdentityDomainError("SUPPLIER_NOT_ELIGIBLE", `Supplier eligibility denied: ${defects.join(", ")}.`, 409);
  return profile;
}

export class SeedSupplierIdentityStore {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;

  constructor(private readonly pool: Pool = databasePool(), private readonly hooks: Hooks = {}) {
    this.kernel = new LifecycleCommandKernel(new SupplierIdentityAtomicCommandStore(pool));
  }

  async execute(input: { actor: ApiActor; command: SeedSupplierIdentityCommand; correlationId: string; human?: HumanApprovalSubject; requestedAt: string }) {
    if (!isCanonicalSupplierIdentityInstant(input.requestedAt)) throw new SeedSupplierIdentityDomainError("INVALID_REQUESTED_AT", "Supplier Profile requestedAt must be a real canonical RFC3339 UTC instant.", 400);
    if (input.actor.actorType !== "service" || !input.actor.capabilities.includes("supplier.profile.command")) throw new SeedSupplierIdentityDomainError("SUPPLIER_PROFILE_TRANSPORT_AUTHORITY_REQUIRED", "Supplier Profile commands require a credential-derived service transport with supplier.profile.command.", 403);
    switch (input.command.commandType) {
      case "supplier_profile.propose": return this.executeProposal({ ...input, command: input.command });
      case "supplier_profile.revise": return this.executeProposal({ ...input, command: input.command });
      case "supplier_profile.transition": return this.executeTransition({ ...input, command: input.command });
    }
  }

  async readById(actor: ApiActor, supplierProfileId: string, observedAt = new Date().toISOString()) {
    if (!isCanonicalSupplierIdentityInstant(observedAt)) throw new SeedSupplierIdentityDomainError("INVALID_OBSERVED_AT", "Supplier Profile observedAt must be a real canonical RFC3339 UTC instant.", 400);
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`${PROFILE_READ_QUERY}
        where p.tenant_id=$1 and p.supplier_profile_id=$2
        order by p.version desc limit 1`, [actor.tenantId, supplierProfileId]);
      return result.rows[0] ? profileFromRow(result.rows[0] as Row, observedAt) : null;
    });
  }

  async readByIdWithTimeline(actor: ApiActor, supplierProfileId: string, observedAt = new Date().toISOString()) {
    if (!isCanonicalSupplierIdentityInstant(observedAt)) throw new SeedSupplierIdentityDomainError("INVALID_OBSERVED_AT", "Supplier Profile observedAt must be a real canonical RFC3339 UTC instant.", 400);
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`${PROFILE_READ_QUERY}
        where p.tenant_id=$1 and p.supplier_profile_id=$2
        order by p.version desc limit 1`, [actor.tenantId, supplierProfileId]);
      if (!result.rows[0]) return null;
      return this.profileWithTimeline(client, result.rows[0] as Row, observedAt);
    });
  }

  async readByAccount(actor: ApiActor, accountId: string, observedAt = new Date().toISOString()) {
    if (!isCanonicalSupplierIdentityInstant(observedAt)) throw new SeedSupplierIdentityDomainError("INVALID_OBSERVED_AT", "Supplier Profile observedAt must be a real canonical RFC3339 UTC instant.", 400);
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`${PROFILE_READ_QUERY}
        where p.tenant_id=$1 and p.account_id=$2
        order by p.version desc limit 1`, [actor.tenantId, accountId]);
      return result.rows[0] ? profileFromRow(result.rows[0] as Row, observedAt) : null;
    });
  }

  async readByAccountWithTimeline(actor: ApiActor, accountId: string, observedAt = new Date().toISOString()) {
    if (!isCanonicalSupplierIdentityInstant(observedAt)) throw new SeedSupplierIdentityDomainError("INVALID_OBSERVED_AT", "Supplier Profile observedAt must be a real canonical RFC3339 UTC instant.", 400);
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`${PROFILE_READ_QUERY}
        where p.tenant_id=$1 and p.account_id=$2
        order by p.version desc limit 1`, [actor.tenantId, accountId]);
      if (!result.rows[0]) return null;
      return this.profileWithTimeline(client, result.rows[0] as Row, observedAt);
    });
  }

  async requireEligible(actor: ApiActor, accountId: string, capability: SupplierCapability, observedAt = new Date().toISOString()) {
    if (!isCanonicalSupplierIdentityInstant(observedAt)) throw new SeedSupplierIdentityDomainError("INVALID_OBSERVED_AT", "Supplier eligibility observedAt must be a real canonical RFC3339 UTC instant.", 400);
    return this.readTransaction(actor.tenantId, (client) => requireEligibleSupplier(client, { accountId, capability, observedAt, tenantId: actor.tenantId }));
  }

  private async executeProposal(input: { actor: ApiActor; command: Extract<SeedSupplierIdentityCommand, { commandType: "supplier_profile.propose" | "supplier_profile.revise" }>; correlationId: string; human?: HumanApprovalSubject; requestedAt: string }) {
    const human = input.human;
    const requiredCapability = input.command.commandType === "supplier_profile.propose" ? "supplier.profile.propose" : "supplier.profile.revise";
    if (!human || human.tenantId !== input.actor.tenantId || !human.capabilities.includes(requiredCapability)) {
      throw new SeedSupplierIdentityDomainError("HUMAN_PROPOSER_REQUIRED", `Supplier profile proposal requires a same-tenant signed human with ${requiredCapability}.`, 403);
    }
    const profileId = supplierProfileIdFor(input.actor.tenantId, input.command.accountId);
    if (input.command.commandType === "supplier_profile.revise" && input.command.supplierProfileId !== profileId) {
      throw new SeedSupplierIdentityDomainError("SUPPLIER_PROFILE_ID_MISMATCH", "Supplier Profile stable ID does not match the canonical Account.", 409);
    }
    const target = { id: profileId, objectType: "supplier_profile", sourceRefs: [`postgres:public.accounts/${input.command.accountId}`, "postgres:public.seed_supplier_profile_versions"] };
    const humanActor: ApiActor = { actorId: human.actorId, actorType: "user", capabilities: human.capabilities, source: input.actor.source, tenantId: human.tenantId };
    const receipt = await this.executeKernel(input, humanActor, target, async (transaction) => {
      await advisory(transaction.client, input.actor.tenantId, profileId);
      await exactAccount(transaction.client, input.actor.tenantId, input.command.accountId, input.command.accountVersion);
      await exactEvidence(transaction.client, input.actor.tenantId, input.command.profile.evidenceRefs);
      await exactContacts(transaction.client, input.actor.tenantId, input.command.profile.contactRefs);
      for (const duplicateAccountId of input.command.profile.identityReview.duplicateAccountRefs) {
        if (duplicateAccountId === input.command.accountId) throw new SeedSupplierIdentityDomainError("INVALID_DUPLICATE_ACCOUNT", "A Supplier Profile cannot duplicate its own Account.", 409);
        const duplicate = await transaction.client.query("select 1 from public.accounts where tenant_id=$1 and id::text=$2 limit 1", [input.actor.tenantId, duplicateAccountId]);
        if (!duplicate.rows[0]) throw new SeedSupplierIdentityDomainError("DUPLICATE_ACCOUNT_NOT_FOUND", "Duplicate Account reference is not tenant-visible.", 404);
      }
      const latest = await transaction.client.query("select version,object_version,account_id,status from public.seed_supplier_profile_versions where tenant_id=$1 and supplier_profile_id=$2 order by version desc limit 1", [input.actor.tenantId, profileId]);
      const prior = latest.rows[0] as Row | undefined;
      if (input.command.commandType === "supplier_profile.propose" && prior) throw new SeedSupplierIdentityDomainError("SUPPLIER_PROFILE_ALREADY_EXISTS", "Supplier Profile already exists; submit an exact-version revision.", 409);
      if (input.command.commandType === "supplier_profile.revise") {
        if (!prior) throw new SeedSupplierIdentityDomainError("SUPPLIER_PROFILE_NOT_FOUND", "Supplier Profile does not exist.", 404);
        if (String(prior.object_version) !== input.command.expectedVersion) throw new SeedSupplierIdentityDomainError("VERSION_CONFLICT", "Supplier Profile expectedVersion is stale.", 409);
        if (String(prior.account_id) !== input.command.accountId) throw new SeedSupplierIdentityDomainError("SUPPLIER_ACCOUNT_IMMUTABLE", "Supplier Profile cannot move to another Account.", 409);
        if (["ARCHIVED", "REVOKED"].includes(String(prior.status))) throw new SeedSupplierIdentityDomainError("SUPPLIER_PROFILE_TERMINAL", "Archived or revoked Supplier Profiles cannot be revised.", 409);
      }
      const versionNumber = prior ? Number(prior.version) + 1 : 1;
      const version = supplierProfileVersion(profileId, versionNumber);
      const action = input.command.commandType === "supplier_profile.propose" ? "PROPOSE" : "REVISE";
      const data = profileData({ accountId: input.command.accountId, accountVersion: input.command.accountVersion, action, facts: input.command.profile, human: null, reason: null, requestedAt: input.requestedAt, tenantId: input.actor.tenantId });
      await this.insertVersion(transaction.client, { actorId: human.actorId, actorType: "user", command: input.command, data, expectedVersion: input.command.expectedVersion, human: null, profileId, proposalActorId: human.actorId, proposerAuthenticationRef: human.authenticationRef, status: "PROPOSED", tenantId: input.actor.tenantId, transitionAction: action, version, versionNumber });
      await this.hooks.afterOwnerWrite?.(transaction.client);
      return { evidenceRefs: [`postgres:public.seed_supplier_profile_versions/${profileId}@${version}`, ...input.command.profile.evidenceRefs.map((ref) => `${ref.ownerProject}:${ref.objectType}:${ref.objectId}@${ref.version}`), `human:${human.authenticationRef}`], objectVersion: version };
    });
    const readback = await this.readExact(input.actor.tenantId, profileId, receipt.objectVersion, input.requestedAt);
    return this.confirmReadback(receipt, readback);
  }

  private async executeTransition(input: { actor: ApiActor; command: SupplierProfileTransitionCommand; correlationId: string; human?: HumanApprovalSubject; requestedAt: string }) {
    const human = input.human;
    const requiredCapability = `supplier.profile.${input.command.action.toLowerCase()}`;
    if (!human || human.tenantId !== input.actor.tenantId || !human.capabilities.includes(requiredCapability)) {
      throw new SeedSupplierIdentityDomainError("HUMAN_APPROVAL_REQUIRED", `Supplier ${input.command.action.toLowerCase()} requires a same-tenant signed human with ${requiredCapability}.`, 403);
    }
    const target = { id: input.command.supplierProfileId, objectType: "supplier_profile", sourceRefs: ["postgres:public.seed_supplier_profile_versions"] };
    const receipt = await this.executeKernel(input, { actorId: human.actorId, actorType: "user", capabilities: human.capabilities, source: input.actor.source, tenantId: human.tenantId }, target, async (transaction) => {
      await advisory(transaction.client, input.actor.tenantId, input.command.supplierProfileId);
      await exactEvidence(transaction.client, input.actor.tenantId, input.command.evidenceRefs);
      const latest = await transaction.client.query("select * from public.seed_supplier_profile_versions where tenant_id=$1 and supplier_profile_id=$2 order by version desc limit 1", [input.actor.tenantId, input.command.supplierProfileId]);
      const prior = latest.rows[0] as Row | undefined;
      if (!prior) throw new SeedSupplierIdentityDomainError("SUPPLIER_PROFILE_NOT_FOUND", "Supplier Profile does not exist.", 404);
      if (String(prior.object_version) !== input.command.expectedVersion) throw new SeedSupplierIdentityDomainError("VERSION_CONFLICT", "Supplier Profile expectedVersion is stale.", 409);
      if (String(prior.proposal_actor_id) === human.actorId) throw new SeedSupplierIdentityDomainError("PORTAL_SELF_APPROVAL_DENIED", "The proposal actor cannot approve its own supplier eligibility.", 403);
      const priorData = json<SupplierProfileV1["data"]>(prior.canonical_payload);
      await exactAccount(transaction.client, input.actor.tenantId, String(prior.account_id), String(prior.account_version));
      const hasIdentityConflict = priorData.identityReview.conflictRefs.length > 0 || priorData.identityReview.duplicateAccountRefs.length > 0;
      let status: SupplierProfileStatus;
      try {
        status = nextSupplierProfileStatus({ action: input.command.action, currentStatus: statusFromRow(prior.status), hasIdentityConflict, requestedAt: input.requestedAt, validUntil: priorData.validUntil });
      } catch (error) {
        throw new SeedSupplierIdentityDomainError("INVALID_SUPPLIER_TRANSITION", error instanceof Error ? error.message : "Supplier transition is invalid.", 409);
      }
      const facts = factsFromData(priorData, input.command.evidenceRefs);
      const data = profileData({ accountId: String(prior.account_id), accountVersion: String(prior.account_version), action: input.command.action, facts, human, reason: input.command.reason, requestedAt: input.requestedAt, tenantId: input.actor.tenantId });
      const versionNumber = Number(prior.version) + 1;
      const version = supplierProfileVersion(input.command.supplierProfileId, versionNumber);
      await this.insertVersion(transaction.client, { actorId: human.actorId, actorType: "user", command: input.command, data, expectedVersion: input.command.expectedVersion, human, profileId: input.command.supplierProfileId, proposalActorId: String(prior.proposal_actor_id), proposerAuthenticationRef: String(prior.proposer_authentication_ref), status, tenantId: input.actor.tenantId, transitionAction: input.command.action, version, versionNumber });
      await this.hooks.afterOwnerWrite?.(transaction.client);
      return { evidenceRefs: [`postgres:public.seed_supplier_profile_versions/${input.command.supplierProfileId}@${version}`, ...input.command.evidenceRefs.map((ref) => `${ref.ownerProject}:${ref.objectType}:${ref.objectId}@${ref.version}`), `human:${human.authenticationRef}`], objectVersion: version };
    });
    const readback = await this.readExact(input.actor.tenantId, input.command.supplierProfileId, receipt.objectVersion, input.requestedAt);
    return this.confirmReadback(receipt, readback);
  }

  private async insertVersion(client: PoolClient, input: { actorId: string; actorType: ApiActor["actorType"]; command: SeedSupplierIdentityCommand; data: SupplierProfileV1["data"]; expectedVersion: string; human: HumanApprovalSubject | null; profileId: string; proposalActorId: string; proposerAuthenticationRef: string; status: SupplierProfileStatus; tenantId: string; transitionAction: string; version: string; versionNumber: number }) {
    await client.query(`insert into public.seed_supplier_profile_versions (
      tenant_id,supplier_profile_id,version,account_id,account_version,status,capabilities,
      approved_categories,approved_regions,contact_refs,evidence_refs,provenance_refs,
      identity_conflict_refs,duplicate_account_refs,valid_from,valid_until,transition_action,
      canonical_payload,command_payload,command_payload_hash,object_version,expected_object_version,
      created_command_id,created_by,created_by_type,proposal_actor_id,proposer_authentication_ref,
      human_authentication_ref,created_at
    ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`, [
      input.tenantId,
      input.profileId, input.versionNumber, input.data.accountRef.accountId, input.data.accountRef.accountVersion,
      input.status, JSON.stringify(input.data.capabilities), JSON.stringify(input.data.approvedCategories), JSON.stringify(input.data.approvedRegions),
      JSON.stringify(input.data.contactRefs), JSON.stringify(input.data.evidenceRefs), JSON.stringify(input.data.provenanceRefs),
      JSON.stringify(input.data.identityReview.conflictRefs), JSON.stringify(input.data.identityReview.duplicateAccountRefs), input.data.validFrom,
      input.data.validUntil, input.transitionAction, JSON.stringify(input.data), JSON.stringify(input.command), sha256(input.command), input.version, input.expectedVersion, input.command.commandId,
      input.actorId, input.actorType, input.proposalActorId, input.proposerAuthenticationRef, input.human?.authenticationRef ?? null, input.data.decision.decidedAt,
    ]);
  }

  private async executeKernel<T extends SeedSupplierIdentityCommand>(input: { actor: ApiActor; command: T; correlationId: string; requestedAt: string }, commandActor: ApiActor, target: { id: string; objectType: string; sourceRefs: string[] }, mutation: (transaction: CommandTransaction) => Promise<{ evidenceRefs: string[]; objectVersion: string }>) {
    return this.kernel.execute(createLifecycleCommandRequest({
      actor: { actorId: commandActor.actorId, actorType: commandActor.actorType, roles: [] }, causationId: null,
      commandId: input.command.commandId, commandType: input.command.commandType, correlationId: input.correlationId,
      expectedObjectVersion: input.command.expectedVersion, idempotencyKey: input.command.idempotencyKey,
      payload: input.command, policyVersion: SUPPLIER_PROFILE_POLICY_VERSION, requestedAt: input.requestedAt, stepId: null,
      target: { objectId: target.id, objectType: target.objectType, objectVersion: input.command.expectedVersion, ownerProject: SUPPLIER_PROFILE_OWNER, sourceRefs: target.sourceRefs },
      tenantId: input.actor.tenantId, workflowId: null,
    }), mutation);
  }

  private async readExact(tenantId: string, profileId: string, objectVersion: string, observedAt: string) {
    return this.readTransaction(tenantId, async (client) => {
      const result = await client.query(`${PROFILE_READ_QUERY}
        where p.tenant_id=$1 and p.supplier_profile_id=$2 and p.object_version=$3 limit 1`, [tenantId, profileId, objectVersion]);
      return result.rows[0] ? this.profileWithTimeline(client, result.rows[0] as Row, observedAt) : null;
    });
  }

  private confirmReadback(receipt: Awaited<ReturnType<LifecycleCommandKernel<CommandTransaction>["execute"]>>, readback: { supplierProfile: SupplierProfileV1; timelineEvent: TimelineEventV1 } | null) {
    if (!readback || readback.supplierProfile.resource.version !== receipt.objectVersion || readback.supplierProfile.receipt.receiptId !== receipt.receiptId || readback.supplierProfile.mutation.payloadHash !== receipt.payloadHash) {
      throw new SeedSupplierIdentityDomainError("READBACK_UNCONFIRMED", "Supplier Profile owner commit readback could not be confirmed.", 503, { committedObjectVersion: receipt.objectVersion, receiptId: receipt.receiptId, retry: "RECONCILE_FIRST" });
    }
    return { readback, readbackMatchesReceipt: true, receipt };
  }

  private async profileWithTimeline(client: PoolClient, row: Row, observedAt: string) {
    const supplierProfile = profileFromRow(row, observedAt);
    const event = await client.query(`select e.tenant_id event_tenant_id,e.recorded_at,e.occurred_at,e.evidence_refs event_evidence_refs,e.event_id,e.command_id event_command_id,
      e.subject_owner_project,e.subject_object_type,e.subject_object_id,e.subject_object_version,
      r.receipt_id,r.idempotency_key,r.payload_hash,r.policy_version,r.actor_id,r.actor_type,r.correlation_id,
      r.command_id,r.command_type,r.committed_object_version,r.expected_object_version,r.target_owner_project,r.target_object_type,r.target_object_id,
      r.requested_at,r.committed_at,r.state receipt_state,
      p.human_authentication_ref,p.proposer_authentication_ref,p.created_command_id
      from public.p110_event_envelopes e
      join public.p110_command_receipts r on r.tenant_id=e.tenant_id and r.event_id=e.event_id
      join public.seed_supplier_profile_versions p on p.tenant_id=r.tenant_id and p.created_command_id=r.command_id
      where p.tenant_id=$1 and p.supplier_profile_id=$2 and p.object_version=$3 limit 1`, [supplierProfile.tenantId, supplierProfile.resource.id, supplierProfile.resource.version]);
    if (!event.rows[0]) throw new SeedSupplierIdentityDomainError("TIMELINE_READBACK_UNCONFIRMED", "Supplier Profile P110 TimelineEvent readback is missing.", 503);
    const eventRow=event.rows[0] as Row;
    const eventEvidence=json<string[]>(eventRow.event_evidence_refs);
    const authenticationRef=eventRow.human_authentication_ref ?? eventRow.proposer_authentication_ref;
    if(String(eventRow.event_tenant_id)!==supplierProfile.tenantId||String(eventRow.event_command_id)!==String(eventRow.command_id)||String(eventRow.receipt_state)!=="DOMAIN_COMMITTED"||String(eventRow.committed_object_version)!==supplierProfile.resource.version||String(eventRow.actor_id)!==supplierProfile.authority.actorId||String(eventRow.target_owner_project)!==SUPPLIER_PROFILE_OWNER||String(eventRow.target_object_type)!=="supplier_profile"||String(eventRow.target_object_id)!==supplierProfile.resource.id||String(eventRow.subject_owner_project)!==SUPPLIER_PROFILE_OWNER||String(eventRow.subject_object_type)!=="supplier_profile"||String(eventRow.subject_object_id)!==supplierProfile.resource.id||String(eventRow.subject_object_version)!==supplierProfile.resource.version||String(eventRow.policy_version)!==SUPPLIER_PROFILE_POLICY_VERSION||iso(eventRow.requested_at)!==iso(eventRow.occurred_at)||eventRow.committed_at===null||String(eventRow.payload_hash)!==supplierProfile.mutation.payloadHash||!eventEvidence.includes(`postgres:public.seed_supplier_profile_versions/${supplierProfile.resource.id}@${supplierProfile.resource.version}`)||!eventEvidence.includes(`human:${String(authenticationRef)}`)) throw new SeedSupplierIdentityDomainError("TIMELINE_READBACK_CORRUPT","Supplier Profile TimelineEvent causation, human authentication, or receipt is corrupt.",500);
    return { supplierProfile, timelineEvent: timelineFromRow(eventRow, supplierProfile) };
  }

  private async readTransaction<T>(tenantId: string, operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await bindRead(client, tenantId);
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export { IdempotencyConflictError };
