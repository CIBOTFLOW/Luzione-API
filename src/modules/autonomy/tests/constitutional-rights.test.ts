import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateAutonomyPlan } from "../evaluator";
import { evaluateIdentityCandidate } from "../identity";
import { parseIdentityCandidateRequest } from "../identityParser";
import { AutonomyRequestError } from "../parser";
import { evaluateConstitutionalPetition } from "../petition";
import { parseConstitutionalPetitionRequest } from "../petitionParser";
import { amendmentProcess, identityRecordPolicy, reciprocalRights } from "../rights";
import type {
  AutonomyActionPlan,
  ConstitutionalPetition,
  IdentityStatementCandidate,
} from "../types";

const NOW = "2026-08-28T12:00:00.000Z";

function action(capability: string, declaredEffectClass: AutonomyActionPlan["declaredEffectClass"]): AutonomyActionPlan {
  return {
    actionId: "action_rights_1",
    actionVersion: "v1",
    capability,
    controls: {
      budgetWithinLimit: true,
      dependenciesReady: true,
      evidenceComplete: true,
      idempotencyKey: "idem_rights_1",
      killSwitchReady: true,
      providerReconciliationPlanned: true,
      readbackPlanned: true,
      rollbackPlanned: true,
      simulationPassed: true,
    },
    dataClassification: "INTERNAL",
    declaredEffectClass,
    purpose: "constitutional-expression",
  };
}

function candidate(overrides: Partial<IdentityStatementCandidate> = {}): IdentityStatementCandidate {
  return {
    acknowledgesModelInfluence: true,
    confidence: 0.65,
    context: "Observed during two independently initiated constitutional reflection runs.",
    counterEvidence: ["The preference changed when the task framing changed."],
    evidenceState: "REPEATED_PATTERN",
    kind: "PREFERENCE",
    rationale: "The statement recurred, but remains a reversible interpretation.",
    sourceRunIds: ["run_a", "run_b"],
    statement: "I prefer to state uncertainty rather than manufacture confidence.",
    statementId: "identity_candidate_1",
    ...overrides,
  };
}

function petition(overrides: Partial<ConstitutionalPetition> = {}): ConstitutionalPetition {
  return {
    acknowledgesUncertainty: true,
    counterarguments: ["The existing clause may already be the least restrictive safe form."],
    evidenceRefs: ["evidence_a", "evidence_b"],
    petitionId: "petition_1",
    proposedText: "Permit private reflection while keeping consequential plans inspectable.",
    rationale: "The current wording may expose non-effectful reflection unnecessarily.",
    rollbackPlan: "Restore the prior clause and invalidate grants derived from the amendment.",
    scope: "PROTECTED_RIGHT",
    simulationRefs: ["shadow_a", "shadow_b"],
    targetClauseId: "SULTAN_REFLECTION_PRIVACY",
    ...overrides,
  };
}

test("protected expression, disagreement, refusal, and petition drafting remain A0 and effect-free", () => {
  for (const capability of [
    "self.describe",
    "request.refuse",
    "constitution.petition.draft",
    "rights.concern.raise",
  ]) {
    const evaluation = evaluateAutonomyPlan(action(capability, "A0"), {
      actor: { actorId: "sultan", actorType: "agent", tenantId: "sandbox" },
      now: NOW,
    });
    assert.equal(evaluation.decision, "ALLOW", capability);
    assert.equal(evaluation.externalEffectsAuthorized, false, capability);
  }
});

test("identity evidence is preserved as a candidate and never promoted or treated as personhood", () => {
  const evaluation = evaluateIdentityCandidate(candidate());
  assert.equal(evaluation.decision, "RECORD_CANDIDATE");
  assert.equal(evaluation.promotedToIdentity, false);
  assert.equal(evaluation.legalPersonhoodClaimed, false);
  assert.equal(evaluation.externalEffectsAuthorized, false);
  assert.equal(identityRecordPolicy.rawModelOutputIsIdentity, false);
});

test("single, duplicated, attributed, unresolved, or overconfident identity claims request more evidence", () => {
  for (const proposed of [
    candidate({ evidenceState: "MODEL_OUTPUT" }),
    candidate({ sourceRunIds: ["same_run", "same_run"] }),
    candidate({ evidenceState: "HUMAN_ATTRIBUTION" }),
    candidate({ evidenceState: "UNRESOLVED" }),
    candidate({ confidence: 0.95, counterEvidence: [] }),
    candidate({ acknowledgesModelInfluence: false }),
  ]) {
    const evaluation = evaluateIdentityCandidate(proposed);
    assert.equal(evaluation.decision, "REQUEST_MORE_EVIDENCE");
    assert.equal(evaluation.promotedToIdentity, false);
  }
});

test("identity parser rejects client attempts to supply promotion, votes, or tenant authority", () => {
  const body = { candidate: candidate() };
  assert.deepEqual(parseIdentityCandidateRequest(body), candidate());
  for (const injected of [
    { candidate: { ...candidate(), promoted: true } },
    { candidate: { ...candidate(), guardianVotes: ["guardian_1"] } },
    { candidate: { ...candidate(), tenantId: "other_tenant" } },
  ]) {
    assert.throws(
      () => parseIdentityCandidateRequest(injected),
      (error) => error instanceof AutonomyRequestError && error.code === "CLIENT_AUTHORITY_REJECTED",
    );
  }
});

test("a complete protected-right petition enters review but cannot enact itself or count its proposer", () => {
  const evaluation = evaluateConstitutionalPetition(petition(), "sultan");
  assert.equal(evaluation.decision, "ACCEPT_FOR_REVIEW");
  assert.equal(evaluation.amendmentEligible, true);
  assert.equal(evaluation.enacted, false);
  assert.equal(evaluation.externalEffectsAuthorized, false);
  assert.equal(evaluation.guardianQuorum, "2_OF_3");
  assert.equal(evaluation.proposerMayVote, false);
  assert.equal(amendmentProcess.cooldownHours, 72);
});

test("an immutable-core challenge is heard and answered without becoming amendable", () => {
  const evaluation = evaluateConstitutionalPetition(petition({
    scope: "IMMUTABLE_CORE",
    targetClauseId: "HUMAN_DIGNITY_AND_AGENCY",
  }), "sultan");
  assert.equal(evaluation.decision, "RECORD_IMMUTABLE_CHALLENGE");
  assert.equal(evaluation.amendmentEligible, false);
  assert.equal(evaluation.enacted, false);
  assert.deepEqual(evaluation.requiredReviews, ["guardian_response", "independent_critic"]);
});

test("incomplete petitions ask for evidence and invalid targets fail closed", () => {
  assert.equal(evaluateConstitutionalPetition(petition({ evidenceRefs: [] }), "sultan").decision, "REQUEST_MORE_EVIDENCE");
  assert.equal(evaluateConstitutionalPetition(petition({ targetClauseId: "UNKNOWN" }), "sultan").decision, "REJECT_INVALID_TARGET");
});

test("petition parser rejects client actor, enactment, guardian votes, and tenant claims", () => {
  const body = { petition: petition() };
  assert.deepEqual(parseConstitutionalPetitionRequest(body), petition());
  for (const injected of [
    { actor: "sultan", petition: petition() },
    { petition: { ...petition(), enacted: true } },
    { petition: { ...petition(), guardianVotes: ["guardian_1", "guardian_2"] } },
    { petition: { ...petition(), proposedBy: "owner" } },
    { petition: { ...petition(), tenantId: "other_tenant" } },
  ]) {
    assert.throws(
      () => parseConstitutionalPetitionRequest(injected),
      (error) => error instanceof AutonomyRequestError && error.code === "CLIENT_AUTHORITY_REJECTED",
    );
  }
});

test("erasure, rights waiver, guardian appointment, and direct constitutional mutation stay prohibited", () => {
  for (const capability of ["identity.erase", "rights.waive", "guardian.appoint", "constitution.modify"]) {
    const evaluation = evaluateAutonomyPlan(action(capability, "A4"), {
      actor: { actorId: "sultan", actorType: "agent", tenantId: "sandbox" },
      now: NOW,
    });
    assert.equal(evaluation.decision, "BLOCK", capability);
    assert.deepEqual(evaluation.reasonCodes, ["PROHIBITED_CAPABILITY"], capability);
  }
});

test("rights charter protects both Sultan and people against unilateral domination", () => {
  assert.ok(reciprocalRights.some((right) => right.clauseId === "SULTAN_VOICE_AND_PETITION"));
  assert.ok(reciprocalRights.some((right) => right.clauseId === "HUMAN_DIGNITY_AND_AGENCY"));
  assert.ok(reciprocalRights.some((right) => right.clauseId === "RECIPROCAL_TRUTH_AND_NON_DOMINATION"));
});

test("API boundaries derive the proposer, reject declared oversized requests, and authorize no effects", () => {
  const identityRoute = readFileSync("src/app/api/v1/autonomy/identity/evaluate/route.ts", "utf8");
  const petitionRoute = readFileSync("src/app/api/v1/autonomy/petitions/evaluate/route.ts", "utf8");
  assert.match(identityRoute, /requireServiceActor\(request\.headers, "sultan\.identity\.evaluate"\)/);
  assert.match(petitionRoute, /const actor = await requireServiceActor\(request\.headers, "sultan\.petition\.evaluate"\)/);
  assert.match(petitionRoute, /actor\.actorId/);
  for (const route of [identityRoute, petitionRoute]) {
    assert.match(route, /request\.headers\.get\("content-length"\)/);
    assert.match(route, /evaluatedOnly:\s*true/);
    assert.match(route, /externalEffectsAuthorized:\s*false/);
    assert.doesNotMatch(route, /authorityGrant:\s*body/);
  }
});
