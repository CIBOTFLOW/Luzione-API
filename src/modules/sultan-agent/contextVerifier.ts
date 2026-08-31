import { sha256 } from "@/modules/platform-guarantees/eventContract";
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

export function canonicalOrderContextHash(readback: SultanOrderReadback) {
  return sha256({
    contractVersion: readback.contractVersion,
    objectVersion: readback.objectVersion,
    order: readback.order,
    sourceOfTruth: readback.sourceOfTruth,
  });
}

export function verifySultanAgentContext(input: {
  intent: SultanAgentIntent;
  orderReadback: SultanOrderReadback | null;
}): { intent: SultanAgentIntent; verification: SultanAgentContextVerification } {
  const synthetic = input.intent.sourceContext.some((context) => context.sourceOwner === "SYNTHETIC_LUZIONE");
  if (synthetic) {
    return {
      intent: input.intent,
      verification: Object.freeze({ kind: "SYNTHETIC_SIMULATION", verifiedCount: 0 }),
    };
  }

  const expectedSourceRef = `api:orders:${input.intent.caseRef.caseId}`;
  const context = input.intent.sourceContext[0];
  const supported = input.intent.caseRef.caseType === "FULFILLMENT"
    && input.intent.sourceContext.length === 1
    && context.sourceOwner === "CIBOTFLOW/Luzione-API"
    && context.sourceRef === expectedSourceRef;

  if (!supported || !input.orderReadback || input.orderReadback.order.orderId !== input.intent.caseRef.caseId) {
    return {
      intent: Object.freeze({
        ...input.intent,
        sourceContext: Object.freeze(input.intent.sourceContext.map((item) => Object.freeze({
          ...item,
          freshness: "UNKNOWN" as const,
        }))),
      }),
      verification: Object.freeze({ kind: "UNVERIFIED", verifiedCount: 0 }),
    };
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
