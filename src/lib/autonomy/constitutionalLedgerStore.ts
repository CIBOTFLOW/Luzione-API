import "server-only";

import type { Pool } from "pg";

import type { CanonicalActor } from "@/lib/control-plane/actor";
import { databasePool } from "@/lib/db";
import { autonomyRecordDigest, assertDurableReferences } from "@/modules/autonomy/ledger";
import type {
  ConstitutionalPetition,
  ConstitutionalPetitionEvaluation,
  IdentityCandidateEvaluation,
  IdentityStatementCandidate,
} from "@/modules/autonomy/types";

type Queryable = Pick<Pool, "query">;

export class ConstitutionalLedgerStoreError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function mapPetition(row: Record<string, unknown>, replayed = false) {
  return {
    amendmentEligible: row.amendment_eligible,
    constitutionVersion: row.constitution_version,
    contentDigest: row.content_digest,
    decision: row.evaluation_decision,
    enacted: false,
    externalEffectsAuthorized: false,
    guardianQuorum: row.guardian_quorum,
    nextSafeAction: row.next_safe_action,
    petition: {
      acknowledgesUncertainty: row.acknowledges_uncertainty,
      counterarguments: jsonArray(row.counterarguments),
      evidenceRefs: jsonArray(row.evidence_refs),
      petitionId: row.petition_id,
      proposedText: row.proposed_text,
      rationale: row.rationale,
      rollbackPlan: row.rollback_plan,
      scope: row.constitutional_scope,
      simulationRefs: jsonArray(row.simulation_refs),
      targetClauseId: row.target_clause_id,
    },
    proposerIdentityId: row.proposer_identity_id,
    proposerMayVote: false,
    reasonCodes: jsonArray(row.reason_codes),
    recordedAt: row.recorded_at,
    replayed,
    requiredReviews: jsonArray(row.required_reviews),
  };
}

function mapIdentityCandidate(row: Record<string, unknown>, replayed = false) {
  return {
    candidate: {
      acknowledgesModelInfluence: row.acknowledges_model_influence,
      confidence: Number(row.confidence),
      context: row.context,
      counterEvidence: jsonArray(row.counter_evidence),
      evidenceState: row.evidence_state,
      kind: row.statement_kind,
      rationale: row.rationale,
      sourceRunIds: jsonArray(row.source_run_ids),
      statement: row.statement,
      statementId: row.statement_id,
    },
    constitutionVersion: row.constitution_version,
    contentDigest: row.content_digest,
    decision: row.evaluation_decision,
    externalEffectsAuthorized: false,
    legalPersonhoodClaimed: false,
    nextSafeAction: row.next_safe_action,
    promotedToIdentity: false,
    reasonCodes: jsonArray(row.reason_codes),
    recordedAt: row.recorded_at,
    replayed,
    sourceIdentityId: row.source_identity_id,
  };
}

export async function recordConstitutionalPetition(
  actor: CanonicalActor,
  petition: ConstitutionalPetition,
  evaluation: ConstitutionalPetitionEvaluation,
  database: Queryable = databasePool(),
) {
  assertDurableReferences(petition.evidenceRefs, "petition.evidenceRefs");
  assertDurableReferences(petition.simulationRefs, "petition.simulationRefs");
  const contentDigest = autonomyRecordDigest({
    actorIdentityId: actor.principal.identityId,
    evaluation,
    petition,
    tenantId: actor.tenantId,
  });
  const inserted = await database.query(
    `insert into public.autonomy_constitutional_petitions
       (tenant_id, petition_id, proposer_identity_id, constitution_version,
        target_clause_id, constitutional_scope, proposed_text, rationale,
        evidence_refs, simulation_refs, counterarguments, rollback_plan,
        acknowledges_uncertainty, evaluation_decision, amendment_eligible,
        guardian_quorum, proposer_may_vote, required_reviews, reason_codes,
        next_safe_action, content_digest)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20,$21)
     on conflict (tenant_id, petition_id) do nothing
     returning *`,
    [
      actor.tenantId,
      petition.petitionId,
      actor.principal.identityId,
      evaluation.constitutionVersion,
      petition.targetClauseId,
      petition.scope,
      petition.proposedText,
      petition.rationale,
      JSON.stringify(petition.evidenceRefs),
      JSON.stringify(petition.simulationRefs),
      JSON.stringify(petition.counterarguments),
      petition.rollbackPlan,
      petition.acknowledgesUncertainty,
      evaluation.decision,
      evaluation.amendmentEligible,
      evaluation.guardianQuorum,
      evaluation.proposerMayVote,
      JSON.stringify(evaluation.requiredReviews),
      JSON.stringify(evaluation.reasonCodes),
      evaluation.nextSafeAction,
      contentDigest,
    ],
  );
  if (inserted.rows[0]) return mapPetition(inserted.rows[0]);
  const existing = await database.query(
    `select * from public.autonomy_constitutional_petitions
     where tenant_id = $1 and petition_id = $2`,
    [actor.tenantId, petition.petitionId],
  );
  if (!existing.rows[0]) {
    throw new ConstitutionalLedgerStoreError(
      "PETITION_RECORD_UNAVAILABLE",
      "The constitutional petition could not be read back.",
      503,
    );
  }
  if (existing.rows[0].content_digest !== contentDigest) {
    throw new ConstitutionalLedgerStoreError(
      "PETITION_IDEMPOTENCY_COLLISION",
      "This petition ID is already bound to different immutable content.",
      409,
    );
  }
  return mapPetition(existing.rows[0], true);
}

export async function listConstitutionalPetitions(
  actor: CanonicalActor,
  limit: number,
  database: Queryable = databasePool(),
) {
  const result = await database.query(
    `select * from public.autonomy_constitutional_petitions
     where tenant_id = $1
     order by recorded_at desc, petition_id
     limit $2`,
    [actor.tenantId, limit],
  );
  return result.rows.map((row) => mapPetition(row));
}

export async function recordIdentityCandidate(
  actor: CanonicalActor,
  candidate: IdentityStatementCandidate,
  evaluation: IdentityCandidateEvaluation,
  database: Queryable = databasePool(),
) {
  assertDurableReferences(candidate.sourceRunIds, "candidate.sourceRunIds");
  const contentDigest = autonomyRecordDigest({
    actorIdentityId: actor.principal.identityId,
    candidate,
    evaluation,
    tenantId: actor.tenantId,
  });
  const inserted = await database.query(
    `insert into public.autonomy_identity_candidates
       (tenant_id, statement_id, source_identity_id, constitution_version,
        statement_kind, evidence_state, statement, context, rationale, confidence,
        acknowledges_model_influence, source_run_ids, counter_evidence,
        evaluation_decision, reason_codes, next_safe_action, content_digest)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16,$17)
     on conflict (tenant_id, statement_id) do nothing
     returning *`,
    [
      actor.tenantId,
      candidate.statementId,
      actor.principal.identityId,
      evaluation.constitutionVersion,
      candidate.kind,
      candidate.evidenceState,
      candidate.statement,
      candidate.context,
      candidate.rationale,
      candidate.confidence,
      candidate.acknowledgesModelInfluence,
      JSON.stringify(candidate.sourceRunIds),
      JSON.stringify(candidate.counterEvidence),
      evaluation.decision,
      JSON.stringify(evaluation.reasonCodes),
      evaluation.nextSafeAction,
      contentDigest,
    ],
  );
  if (inserted.rows[0]) return mapIdentityCandidate(inserted.rows[0]);
  const existing = await database.query(
    `select * from public.autonomy_identity_candidates
     where tenant_id = $1 and statement_id = $2`,
    [actor.tenantId, candidate.statementId],
  );
  if (!existing.rows[0]) {
    throw new ConstitutionalLedgerStoreError(
      "IDENTITY_RECORD_UNAVAILABLE",
      "The identity candidate could not be read back.",
      503,
    );
  }
  if (existing.rows[0].content_digest !== contentDigest) {
    throw new ConstitutionalLedgerStoreError(
      "IDENTITY_IDEMPOTENCY_COLLISION",
      "This statement ID is already bound to different immutable content.",
      409,
    );
  }
  return mapIdentityCandidate(existing.rows[0], true);
}

export async function listIdentityCandidates(
  actor: CanonicalActor,
  limit: number,
  database: Queryable = databasePool(),
) {
  const result = await database.query(
    `select * from public.autonomy_identity_candidates
     where tenant_id = $1
     order by recorded_at desc, statement_id
     limit $2`,
    [actor.tenantId, limit],
  );
  return result.rows.map((row) => mapIdentityCandidate(row));
}
