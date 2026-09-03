import type { ApiActor } from "@/lib/api/actor";
import {
  stage5AdmissionRequestHash,
  type CanonicalReadbackRequest,
  type OutcomeObservationRequest,
  type Stage5AdmissionAssertion,
  type Stage5Pins,
} from "./contracts";
import { evaluateStage5Admission } from "./policy";
import { PostgresSultanStage5Store, SultanStage5StoreError } from "./postgresStore";
import { verifyOutcomeObservationReceipt } from "./runtime";
import { isExactStage5ConsumerWorkload } from "./workload";

export class SultanStage5Service {
  constructor(
    private readonly store: PostgresSultanStage5Store,
    private readonly pins: Stage5Pins,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async admit(actor: ApiActor, assertion: Stage5AdmissionAssertion) {
    this.assertConsumer(actor, "sultan.stage5.admission.request");
    const readbacks = await this.store.readAdmissionEvidence(actor.tenantId, assertion.evidence.readbackReceiptIds);
    const evaluation = evaluateStage5Admission({
      actor,
      assertion,
      decidedAt: this.now().toISOString(),
      pins: this.pins,
      readbacks,
      requestHash: stage5AdmissionRequestHash(assertion),
    });
    return this.store.recordAdmission(actor, evaluation);
  }

  async canonicalReadback(actor: ApiActor, request: CanonicalReadbackRequest) {
    this.assertConsumer(actor, "sultan.canonical.readback.read");
    const now = this.now().toISOString();
    this.assertFreshRequest(request.requestedAt, now);
    return this.store.createCanonicalReadback({ actor, now, pins: this.pins, request });
  }

  async observeOutcome(actor: ApiActor, request: OutcomeObservationRequest) {
    this.assertConsumer(actor, "sultan.outcome.observe");
    const now = this.now().toISOString();
    this.assertFreshRequest(request.requestedAt, now);
    return this.store.recordOutcome({ actor, apiDeploymentSha: this.pins.apiDeploymentSha, now, request });
  }

  async readVerifiedOutcome(actor: ApiActor, observationId: string) {
    this.assertConsumer(actor, "sultan.outcome.observe");
    if (!/^s5out_[a-f0-9]{32}$/.test(observationId)) {
      throw new SultanStage5StoreError("INVALID_OUTCOME_OBSERVATION_ID", "The observation receipt identifier is invalid.", 400);
    }
    const receipt = await this.store.readOutcome(actor.tenantId, observationId);
    if (!receipt) {
      throw new SultanStage5StoreError("OUTCOME_OBSERVATION_NOT_FOUND", "No tenant-bound outcome observation was found.", 404);
    }
    const [admission, readback] = await Promise.all([
      this.store.readAdmission(actor.tenantId, receipt.admissionReceiptId),
      this.store.readCanonicalReadback(actor.tenantId, receipt.evidence.readbackReceiptId),
    ]);
    if (receipt.observationId !== observationId || !admission || !readback || !verifyOutcomeObservationReceipt({
      admission,
      expectedApiDeploymentSha: this.pins.apiDeploymentSha,
      readback,
      receipt,
    })) {
      throw new SultanStage5StoreError("OUTCOME_RECEIPT_INTEGRITY_FAILED", "Stored outcome receipt lineage failed closed.", 503);
    }
    return receipt;
  }

  private assertConsumer(actor: ApiActor, capability: string) {
    if (!isExactStage5ConsumerWorkload(actor, capability)) {
      throw new SultanStage5StoreError("WORKLOAD_IDENTITY_DENIED", "An exact registered Sultan OS or Luzione UI Vercel workload identity with the required capability is required.", 403);
    }
  }

  private assertFreshRequest(requestedAt: string, now: string) {
    const requestMillis = Date.parse(requestedAt);
    const nowMillis = Date.parse(now);
    if (!Number.isFinite(requestMillis) || requestMillis > nowMillis + 30_000
      || nowMillis - requestMillis > this.pins.maximumEvidenceAgeMs) {
      throw new SultanStage5StoreError("REQUEST_STALE", "The Stage 5 request is outside the exact bounded freshness window.", 409);
    }
  }
}
