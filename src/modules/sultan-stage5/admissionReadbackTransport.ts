// Default-OFF Stage 5 evidence retrieval. The existing PostgreSQL store performs
// tenant-scoped READ ONLY transactions and checks indexed columns against JSONB.
// This adapter adds an independent lineage gate; it cannot grant execution rights.
import type { ApiActor } from "@/lib/api/actor";
import {
  canonicalClaimEvidenceBinding, stage5EvidenceRefsHash,
  type CanonicalReadbackReceipt, type Stage5AdmissionReceipt,
} from "./contracts";
export class Stage5ReadbackTransportError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super("Stage 5 readback unavailable or not verified.");
    this.name = "Stage5ReadbackTransportError";
  }
}
import { verifyCanonicalReadbackReceiptIntegrity, verifyStage5AdmissionReceiptIntegrity } from "./runtime";
import { isExactStage5ConsumerWorkload } from "./workload";

type ReadStore = {
  readAdmission(tenantId: string, receiptId: string): Promise<Stage5AdmissionReceipt | null>;
  readCanonicalReadback(tenantId: string, receiptId: string): Promise<CanonicalReadbackReceipt | null>;
};
const ADMISSION_ID = /^s5admit_[a-f0-9]{32}$/;
const READBACK_ID = /^s5read_[a-f0-9]{32}$/;
const MAX_AGE_MS = 5 * 60_000;
const CLOCK_SKEW_MS = 30_000;
function deny(code: string, status = 503): never {
  throw new Stage5ReadbackTransportError(code, status);
}
function validAdmission(receipt: Stage5AdmissionReceipt, tenantId: string, nowMs: number) {
  try {
    return verifyStage5AdmissionReceiptIntegrity(receipt)
      && receipt.credentialActor.tenantId === tenantId
      && receipt.credentialActor.actorId === "service:sultan-os"
      && receipt.credentialActor.actorType === "service"
      && receipt.credentialActor.source === "vercel-oidc"
      && receipt.status === "ADMITTED_NO_EFFECT"
      && receipt.admittedEffectClass === "A0"
      && receipt.requestedEffectClass === "A0"
      && receipt.requestedCapability === "sultan.case.read"
      && receipt.purpose === "sultan-shadow-case-read"
      && receipt.phase === "SIMULATION"
      && receipt.effectAuthority === "NO_EFFECT"
      && receipt.authorizesInference === false
      && receipt.externalEffectsAuthorized === false
      && receipt.evidence.sourceVerification
        === "API_CANONICAL_READBACKS_VERIFIED_CONTEXT_HASH_SULTAN_ASSERTED"
      && Number.isFinite(Date.parse(receipt.decidedAt))
      && Date.parse(receipt.decidedAt) <= nowMs + CLOCK_SKEW_MS
      && nowMs - Date.parse(receipt.decidedAt) <= MAX_AGE_MS;
  } catch { return false; }
}
function validReadback(row: CanonicalReadbackReceipt, id: string, tenantId: string, nowMs: number) {
  try {
    return row.readbackReceiptId === id && row.tenantId === tenantId
      && verifyCanonicalReadbackReceiptIntegrity(row)
      && row.status === "AVAILABLE" && row.provenance.authority === "CANONICAL_POSTGRES"
      && ["service:sultan-os", "service:luzione-ui"].includes(row.consumer.actorId)
      && Number.isFinite(Date.parse(row.observedAt))
      && Date.parse(row.observedAt) <= nowMs + CLOCK_SKEW_MS
      && row.freshUntil !== null && Date.parse(row.freshUntil) > nowMs;
  } catch { return false; }
}

/** A separate authenticated A0 read, NOT an admission or a signing operation.
 * Disabled unless the caller explicitly supplies the server-side feature flag.
 * Existing store reads are independent, immutable, tenant-scoped READ ONLY
 * transactions; the lineage and every referenced row are checked before return.
 */
export async function readStage5AdmissionBundle(input: {
  actor: ApiActor; admissionReceiptId: string; store: ReadStore;
  enabled?: boolean; now?: Date;
}) {
  if (input.enabled !== true) deny("STAGE5_READBACK_DISABLED", 404);
  const { actor, admissionReceiptId, store } = input;
  if (!isExactStage5ConsumerWorkload(actor, "sultan.stage5.admission.read")
      || actor.actorId !== "service:sultan-os") deny("STAGE5_READBACK_IDENTITY_DENIED", 403);
  if (!ADMISSION_ID.test(admissionReceiptId)) deny("STAGE5_READBACK_ID_INVALID", 400);
  const nowMs = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(nowMs)) deny("STAGE5_READBACK_CLOCK_INVALID");
  const admission = await store.readAdmission(actor.tenantId, admissionReceiptId);
  if (!admission) deny("STAGE5_ADMISSION_NOT_FOUND", 404);
  if (admission.admissionReceiptId !== admissionReceiptId
      || !validAdmission(admission, actor.tenantId, nowMs)) deny("STAGE5_ADMISSION_NOT_VERIFIED");
  const ids = admission.evidence.readbackReceiptIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50
      || new Set(ids).size !== ids.length || ids.some(id => !READBACK_ID.test(id)))
    deny("STAGE5_READBACK_SET_INVALID");
  const readbacks: CanonicalReadbackReceipt[] = [];
  for (const id of ids) {
    const row = await store.readCanonicalReadback(actor.tenantId, id);
    if (!row || !validReadback(row, id, actor.tenantId, nowMs))
      deny("STAGE5_READBACK_NOT_VERIFIED");
    readbacks.push(row);
  }
  if (stage5EvidenceRefsHash(readbacks) !== admission.evidence.evidenceRefsHash)
    deny("STAGE5_EVIDENCE_LINEAGE_MISMATCH");
  const byId = new Map(readbacks.map(row => [row.readbackReceiptId, row]));
  for (const consumed of admission.evidence.consumedEvidence) {
    const row = byId.get(consumed.readbackReceiptId);
    const claim = row?.claims.find(item => item.claimId === consumed.claimId);
    if (!row || !claim || consumed.readbackHash !== row.readbackHash) deny("STAGE5_CLAIM_LINEAGE_MISMATCH");
    const exact = canonicalClaimEvidenceBinding(row, claim);
    if (exact.evidenceRef !== consumed.evidenceRef || exact.evidenceHash !== consumed.evidenceHash)
      deny("STAGE5_CLAIM_LINEAGE_MISMATCH");
  }
  return Object.freeze({ admission, readbacks: Object.freeze(readbacks) });
}
