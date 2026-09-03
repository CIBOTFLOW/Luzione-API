export const A02_SHARED_CONTRACT_BUNDLE_VERSION = "luzione-shared-contracts/v0.2-draft.1";
export const A02_IDENTITY_TENANT_CONTRACT_VERSION = "luzione-identity-tenant/v0.2-draft.1";
export const A02_COMMAND_CONTRACT_VERSION = "luzione-command-envelope/v0.2-draft.1";
export const A02_RECEIPT_CONTRACT_VERSION = "luzione-receipt-envelope/v0.2-draft.1";
export const A02_READBACK_CONTRACT_VERSION = "luzione-readback-envelope/v0.2-draft.1";

export const a02RequiredConsumerPins = Object.freeze({
  bundle: A02_SHARED_CONTRACT_BUNDLE_VERSION,
  command: A02_COMMAND_CONTRACT_VERSION,
  identityTenant: A02_IDENTITY_TENANT_CONTRACT_VERSION,
  readback: A02_READBACK_CONTRACT_VERSION,
  receipt: A02_RECEIPT_CONTRACT_VERSION,
});

export type A02ConsumerPins = typeof a02RequiredConsumerPins;

export type A02IdentityTenantDraft = {
  authority: {
    authorityClass: string;
    capability: string;
    purpose: string;
  };
  contractVersion: typeof A02_IDENTITY_TENANT_CONTRACT_VERSION;
  credentialActor: {
    actorId: string;
    actorType: "agent" | "service" | "user";
    credentialSource: "service-token" | "vercel-oidc";
  };
  logicalActor: {
    actorId: string;
    actorType: "agent";
    definitionVersion: string;
    delegationEvidenceRef: string;
  } | null;
  request: {
    correlationId: string;
    requestId: string;
    requestedAt: string;
    spanId: string;
    traceId: string;
  };
  serverDerived: true;
  sourceVersionRefs: readonly string[];
  tenant: {
    boundary: "EXACT";
    source: "VERIFIED_CREDENTIAL";
    tenantId: string;
  };
};

export type A02CommandDraft = {
  activation: "DRAFT_ONLY";
  commandId: string;
  commandType: string;
  context: A02IdentityTenantDraft;
  contractVersion: typeof A02_COMMAND_CONTRACT_VERSION;
  expectedObjectVersion: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  policyVersionRefs: readonly string[];
  requestedAt: string;
  requestedEffect: {
    authorizationRef: null;
    effectClass: "NO_EFFECT";
  };
  target: {
    objectId: string;
    objectType: string;
    objectVersion: string;
    ownerProject: string;
  };
};

export type A02ReceiptDraft = {
  commandId: string;
  contractVersion: typeof A02_RECEIPT_CONTRACT_VERSION;
  correlationId: string;
  effectAuthority: "NOT_GRANTED_BY_CONTRACT";
  evidence: {
    eventId: string;
    outboxMessageId: string;
  };
  idempotency: {
    key: string;
    payloadHash: string;
    replay: boolean;
  };
  object: {
    id: string;
    type: string;
    version: string;
    ownerProject: string;
  };
  receiptId: string;
  state: "DISPATCH_PENDING" | "DOMAIN_COMMITTED";
  tenantId: string;
};

export type A02ReadbackDraft = {
  businessFinal: boolean;
  contractVersion: typeof A02_READBACK_CONTRACT_VERSION;
  evidence: {
    commandId: string | null;
    eventId: string | null;
    providerAcknowledgementRef: string | null;
    receiptId: string;
    reconciliationId: string | null;
    sourceReadbackRef: string | null;
  };
  finality: "DOMAIN_COMMITTED" | "MISSING" | "PROVIDER_ACKNOWLEDGED" | "RECONCILING" | "SOURCE_CONFIRMED";
  freshness: {
    freshUntil: string | null;
    observedAt: string | null;
    state: "FRESH" | "NOT_APPLICABLE" | "STALE" | "UNKNOWN";
  };
  object: {
    id: string | null;
    ownerProject: string | null;
    type: string | null;
    version: string | null;
  };
  reason: string;
  tenantId: string;
};

export const a02CompatibilityMatrix = Object.freeze([
  {
    draft: A02_IDENTITY_TENANT_CONTRACT_VERSION,
    mode: "LOSSLESS_ADAPTER",
    sources: ["luzione-authority-subject/v0.1", "luzione-request-identity/v1"],
  },
  {
    draft: A02_COMMAND_CONTRACT_VERSION,
    mode: "LOSSLESS_ADAPTER",
    sources: ["luzione-command-ledger/v0.1"],
  },
  {
    draft: A02_RECEIPT_CONTRACT_VERSION,
    mode: "BOUNDED_ADAPTER",
    sources: ["luzione-command-ledger/v0.1", "luzione-platform-receipt/v1"],
  },
  {
    draft: A02_READBACK_CONTRACT_VERSION,
    mode: "LOSSLESS_ADAPTER",
    sources: ["luzione-causal-readback/v0.1"],
  },
] as const);

export function assertA02ConsumerPins(pins: Record<string, string>) {
  for (const [name, version] of Object.entries(a02RequiredConsumerPins)) {
    if (pins[name] !== version) {
      throw new Error(`A02 consumer pin ${name} must be ${version}.`);
    }
  }
  const unknownPins = Object.keys(pins).filter((name) => !(name in a02RequiredConsumerPins));
  if (unknownPins.length > 0) throw new Error(`Unknown A02 consumer pins: ${unknownPins.sort().join(", ")}.`);
}
