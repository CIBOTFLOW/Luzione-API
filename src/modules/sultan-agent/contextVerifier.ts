import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { Stage5Pins, VerifiedCanonicalReadbackRef } from "@/modules/sultan-stage5/contracts";
import type { SultanAgentIntent } from "./contracts";

export type SultanAgentContextVerification = {
  kind: "CANONICAL_READBACK" | "SYNTHETIC_SIMULATION" | "UNVERIFIED";
  verifiedCount: number;
};

export type SultanOrderReadback = {
  contractVersion: string;
  objectVersion: string;
  order: {
    orderId: string;
    updatedAt: string;
    [key: string]: unknown;
  };
  sourceOfTruth: string;
};

const STAGE5_CANONICAL_READBACK_PREFIX = "api:canonical-readback/";

export function stage5CanonicalReadbackReceiptIds(intent: SultanAgentIntent) {
  if (!intent.sourceContext.every((context) =>
    context.sourceOwner === "CIBOTFLOW/Luzione-API"
    && context.sourceRef.startsWith(STAGE5_CANONICAL_READBACK_PREFIX))) return null;
  const receiptIds = intent.sourceContext.map((context) =>
    context.sourceRef.slice(STAGE5_CANONICAL_READBACK_PREFIX.length));
  if (receiptIds.some((receiptId) => !/^s5read_[a-f0-9]{32}$/.test(receiptId))
    || new Set(receiptIds).size !== receiptIds.length) return null;
  return Object.freeze(receiptIds);
}

export function canonicalOrderContextHash(readback: SultanOrderReadback) {
  return sha256({
    contractVersion: readback.contractVersion,
    objectVersion: readback.objectVersion,
    order: readback.order,
    sourceOfTruth: readback.sourceOfTruth,
  });
}

export function verifySultanAgentContext(input: {
  canonicalReadbacks?: readonly VerifiedCanonicalReadbackRef[];
  intent: SultanAgentIntent;
  now?: string;
  orderReadback: SultanOrderReadback | null;
  stage5Pins?: Pick<Stage5Pins, "maximumEvidenceAgeMs" | "uiDeploymentSha">;
  tenantId?: string;
}): { intent: SultanAgentIntent; verification: SultanAgentContextVerification } {
  const syntheticCount = input.intent.sourceContext.filter((context) =>
    context.sourceOwner === "SYNTHETIC_LUZIONE").length;
  if (syntheticCount === input.intent.sourceContext.length) {
    return {
      intent: input.intent,
      verification: Object.freeze({ kind: "SYNTHETIC_SIMULATION", verifiedCount: 0 }),
    };
  }
  if (syntheticCount > 0) return unverified(input.intent);

  const stage5ReceiptIds = stage5CanonicalReadbackReceiptIds(input.intent);
  if (stage5ReceiptIds) {
    return verifyStage5CanonicalReadbacks({
      intent: input.intent,
      now: input.now ?? new Date().toISOString(),
      pins: input.stage5Pins,
      readbacks: input.canonicalReadbacks ?? [],
      receiptIds: stage5ReceiptIds,
      tenantId: input.tenantId ?? "",
    });
  }

  const expectedSourceRef = `api:orders:${input.intent.caseRef.caseId}`;
  const context = input.intent.sourceContext[0];
  const supported = input.intent.caseRef.caseType === "FULFILLMENT"
    && input.intent.sourceContext.length === 1
    && context.sourceOwner === "CIBOTFLOW/Luzione-API"
    && context.sourceRef === expectedSourceRef;

  if (!supported || !input.orderReadback || input.orderReadback.order.orderId !== input.intent.caseRef.caseId) {
    return unverified(input.intent);
  }

  const canonicalHash = canonicalOrderContextHash(input.orderReadback);
  const versionMatches = context.sourceVersion === input.orderReadback.objectVersion
    && (input.intent.caseRef.expectedVersion === null
      || input.intent.caseRef.expectedVersion === input.orderReadback.objectVersion);
  const integrityMatches = context.integrityHash === canonicalHash;
  const freshness = versionMatches && integrityMatches ? "FRESH" as const : "STALE" as const;

  return {
    intent: Object.freeze({
      ...input.intent,
      sourceContext: Object.freeze([Object.freeze({
        ...context,
        freshness,
        integrityHash: canonicalHash,
        observedAt: input.orderReadback.order.updatedAt,
        sourceVersion: input.orderReadback.objectVersion,
      })]),
    }),
    verification: Object.freeze({ kind: "CANONICAL_READBACK", verifiedCount: 1 }),
  };
}

function verifyStage5CanonicalReadbacks(input: {
  intent: SultanAgentIntent;
  now: string;
  pins: Pick<Stage5Pins, "maximumEvidenceAgeMs" | "uiDeploymentSha"> | undefined;
  readbacks: readonly VerifiedCanonicalReadbackRef[];
  receiptIds: readonly string[];
  tenantId: string;
}): { intent: SultanAgentIntent; verification: SultanAgentContextVerification } {
  const byId = new Map(input.readbacks.map((readback) => [readback.readbackReceiptId, readback]));
  const nowMillis = Date.parse(input.now);
  let verifiedCount = 0;
  const sourceContext = input.intent.sourceContext.map((context, index) => {
    const readback = byId.get(input.receiptIds[index]);
    if (!readback) return Object.freeze({ ...context, freshness: "UNKNOWN" as const });
    const observedMillis = Date.parse(readback.observedAt);
    const freshUntilMillis = readback.freshUntil ? Date.parse(readback.freshUntil) : Number.NaN;
    const receiptMatches = Boolean(input.pins)
      && readback.consumerActorId === "service:luzione-ui"
      && readback.consumerReleaseSha === input.pins?.uiDeploymentSha
      && readback.tenantId === input.tenantId
      && readback.status === "AVAILABLE"
      && readback.readbackReceiptId === input.receiptIds[index]
      && readback.readbackHash === context.integrityHash
      && readback.sourceVersion !== null
      && readback.readbackHash === context.sourceVersion
      && readback.observedAt === context.observedAt;
    const current = receiptMatches
      && Number.isFinite(nowMillis)
      && Number.isFinite(observedMillis)
      && Number.isFinite(freshUntilMillis)
      && observedMillis <= nowMillis + 30_000
      && nowMillis - observedMillis <= (input.pins?.maximumEvidenceAgeMs ?? 0)
      && freshUntilMillis > nowMillis;
    if (receiptMatches) verifiedCount += 1;
    return Object.freeze({
      ...context,
      freshness: current ? "FRESH" as const : "STALE" as const,
      integrityHash: readback.readbackHash,
      observedAt: readback.observedAt,
      sourceVersion: readback.readbackHash,
    });
  });
  const exactSet = input.readbacks.length === input.receiptIds.length
    && byId.size === input.receiptIds.length
    && verifiedCount === input.receiptIds.length;
  return {
    intent: Object.freeze({ ...input.intent, sourceContext: Object.freeze(sourceContext) }),
    verification: Object.freeze({
      kind: exactSet ? "CANONICAL_READBACK" as const : "UNVERIFIED" as const,
      verifiedCount,
    }),
  };
}

function unverified(intent: SultanAgentIntent) {
  return {
    intent: Object.freeze({
      ...intent,
      sourceContext: Object.freeze(intent.sourceContext.map((item) => Object.freeze({
        ...item,
        freshness: "UNKNOWN" as const,
      }))),
    }),
    verification: Object.freeze({ kind: "UNVERIFIED" as const, verifiedCount: 0 }),
  };
}
