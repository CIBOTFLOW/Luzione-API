// Default-OFF signed A0 receipt envelope. No network, persistence or effect authority.
// The HMAC proves possession of a separately provisioned key; deployment custody and
// production Stage 5 authorization must be verified independently before activation.
import { createHmac, randomBytes } from "node:crypto";
import type { ApiActor } from "@/lib/api/actor";
import { canonicalJson, sha256 } from "@/modules/platform-guarantees/eventContract";
import type { SultanToolCall, SultanToolManifest, SultanToolResult } from "./contracts";

export const SULTAN_A0_RECEIPT_ENVELOPE_V1 = "sultan.luzione-a0-transport-envelope.v1" as const;
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ADMISSION = /^s5admit_[a-f0-9]{32}$/;
const MAX_OBSERVATION_AGE_MS = 48 * 60 * 60 * 1000;
const TTL_MS = 4 * 60 * 1000;
const CLOCK_SKEW_MS = 30_000;

export type A0SignedReceiptEnvelope = Readonly<{
  schemaVersion: typeof SULTAN_A0_RECEIPT_ENVELOPE_V1;
  issuer: "luzione-api";
  audience: "sultan-os";
  tenantId: "luzione";
  workloadActorId: "service:sultan-os";
  keyId: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  manifestHash: string;
  resultHash: string;
  signature: string;
}>;

function deny(): never {
  // Deliberately constant: no case, credential, source reference or snapshot in errors.
  throw new Error("A0_RECEIPT_SIGNING_DENIED");
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function sameJson(a: unknown, b: unknown) {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Sign only an already admitted, READY A0 case read by the exact OIDC workload.
 * The caller must invoke the gateway first: this function does NOT admit Stage 5.
 * The manifest returned alongside this envelope must be the SAME manifest signed
 * here (not a separate GET /tools manifest with a different generatedAt).
 */
export function signA0ReceiptEnvelope(input: {
  actor: ApiActor;
  call: SultanToolCall;
  manifest: SultanToolManifest;
  toolResult: SultanToolResult;
  keyId: string;
  signingKey: Buffer;
  now?: Date;
  nonce?: Buffer;
}): A0SignedReceiptEnvelope {
  const { actor, call, manifest, toolResult, keyId, signingKey } = input;
  const now = input.now ?? new Date();
  const nonce = input.nonce ?? randomBytes(16);
  if (actor.source !== "vercel-oidc" || actor.actorType !== "service" ||
      actor.actorId !== "service:sultan-os" || actor.tenantId !== "luzione" ||
      !["sultan.tool.invoke", "sultan.tool.manifest.read", "sultan.case.read"]
        .every(capability => actor.capabilities.includes(capability)) ||
      !KEY_ID.test(keyId) || !Buffer.isBuffer(signingKey) ||
      signingKey.length < 32 || signingKey.length > 128 ||
      !Buffer.isBuffer(nonce) || nonce.length !== 16 ||
      !Number.isFinite(now.getTime())) deny();

  if (call.contractVersion !== "luzione-sultan-tool-call/v1" ||
      !ADMISSION.test(call.admissionReceiptId) ||
      call.toolId !== "luzione.case_context.read" || call.toolVersion !== "v1" ||
      call.purpose !== "sultan-shadow-case-read" ||
      call.caseRef.expectedVersion === null ||
      call.controlEvidence !== null ||
      call.contextRefs.length !== 0 ||
      Object.keys(call.arguments).length !== 0 ||
      call.argumentsHash !== sha256({}) ||
      manifest.contractVersion !== "luzione-sultan-tool-manifest/v1" ||
      manifest.tenantId !== "luzione" ||
      manifest.workloadActorId !== "service:sultan-os" ||
      manifest.discoveryGrantsAuthority !== false ||
      !sameJson(manifest.caseRef, call.caseRef) ||
      !sameJson(manifest.logicalAgent, call.agent) ||
      !validTime(manifest.generatedAt) ||
      Math.abs(now.getTime() - Date.parse(manifest.generatedAt)) > TTL_MS ||
      !manifest.tools.some(t => t.toolId === "luzione.case_context.read" &&
        t.toolVersion === "v1" && t.effectClass === "A0" &&
        t.capability === "sultan.case.read" && t.available === true)) deny();

  const { manifestHash, ...unsignedManifest } = manifest;
  if (!SHA256.test(manifestHash) || sha256(unsignedManifest) !== manifestHash ||
      toolResult.contractVersion !== "luzione-sultan-tool-result/v1" ||
      toolResult.operationId !== call.operationId ||
      toolResult.toolCallId !== call.toolCallId ||
      toolResult.toolId !== call.toolId ||
      toolResult.status !== "READY" || toolResult.effectClass !== "A0" ||
      toolResult.policyDecision !== "ALLOW" || toolResult.sourceFreshness !== "FRESH" ||
      toolResult.receiptRef !== null || toolResult.readbackRef !== null ||
      toolResult.failureCode !== null || !toolResult.result ||
      !SHA256.test(toolResult.resultHash) ||
      sha256(toolResult.result) !== toolResult.resultHash) deny();

  const snapshot = toolResult.result.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) deny();
  const observed = snapshot as Record<string, unknown>;
  if (observed.caseType !== call.caseRef.caseType ||
      observed.objectVersion !== call.caseRef.expectedVersion ||
      !validTime(observed.observedAt) ||
      Date.parse(observed.observedAt) > now.getTime() + CLOCK_SKEW_MS ||
      now.getTime() - Date.parse(observed.observedAt) > MAX_OBSERVATION_AGE_MS ||
      !Array.isArray(observed.sourceRefs) || observed.sourceRefs.length === 0 ||
      !sameJson(observed.sourceRefs, toolResult.sourceRefs)) deny();

  const issuedAt = now.toISOString();
  const unsigned = {
    schemaVersion: SULTAN_A0_RECEIPT_ENVELOPE_V1,
    issuer: "luzione-api" as const,
    audience: "sultan-os" as const,
    tenantId: "luzione" as const,
    workloadActorId: "service:sultan-os" as const,
    keyId, issuedAt, expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
    nonce: nonce.toString("hex"), manifestHash, resultHash: toolResult.resultHash,
  };
  return Object.freeze({
    ...unsigned,
    signature: createHmac("sha256", signingKey).update(canonicalJson(unsigned)).digest("hex"),
  });
}

/** No key is generated, persisted, logged, or loaded when the flag is absent. */
export function maybeSignA0Receipt(input: Omit<Parameters<typeof signA0ReceiptEnvelope>[0],
  "keyId" | "signingKey">, env: Record<string, string | undefined> = process.env) {
  if (env.LUZIONE_SULTAN_A0_RECEIPT_SIGNING_ENABLED !== "true") return null;
  const keyId = env.LUZIONE_SULTAN_A0_RECEIPT_KEY_ID ?? "";
  const encoded = env.LUZIONE_SULTAN_A0_RECEIPT_HMAC_KEY_B64 ?? "";
  if (!KEY_ID.test(keyId) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
      encoded.length % 4 !== 0) deny();
  const signingKey = Buffer.from(encoded, "base64");
  if (signingKey.toString("base64") !== encoded) deny();
  return signA0ReceiptEnvelope({ ...input, keyId, signingKey });
}
