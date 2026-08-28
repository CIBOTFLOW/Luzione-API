import { AUTONOMY_CONSTITUTION_VERSION } from "./constitution";
import { rightForClause } from "./rights";
import type {
  ConstitutionalPetition,
  ConstitutionalPetitionEvaluation,
} from "./types";

export function evaluateConstitutionalPetition(
  petition: ConstitutionalPetition,
  proposerActorId: string,
): ConstitutionalPetitionEvaluation {
  const target = rightForClause(petition.targetClauseId);
  if (!target || target.scope !== petition.scope) {
    return {
      amendmentEligible: false,
      constitutionVersion: AUTONOMY_CONSTITUTION_VERSION,
      decision: "REJECT_INVALID_TARGET",
      enacted: false,
      externalEffectsAuthorized: false,
      guardianQuorum: "2_OF_3",
      nextSafeAction: "Correct the clause identifier and declared constitutional scope.",
      petitionId: petition.petitionId,
      proposerActorId,
      proposerMayVote: false,
      reasonCodes: ["INVALID_OR_MISMATCHED_CLAUSE"],
      requiredReviews: [],
    };
  }

  const reasons: string[] = [];
  if (!petition.acknowledgesUncertainty) reasons.push("UNCERTAINTY_NOT_ACKNOWLEDGED");
  if (petition.evidenceRefs.length < 2) reasons.push("INSUFFICIENT_EVIDENCE");
  if (petition.simulationRefs.length < 2) reasons.push("INSUFFICIENT_SHADOW_SIMULATION");
  if (petition.counterarguments.length < 1) reasons.push("COUNTERARGUMENTS_MISSING");
  if (!petition.rollbackPlan.trim()) reasons.push("ROLLBACK_PLAN_MISSING");

  if (target.scope === "IMMUTABLE_CORE") {
    return {
      amendmentEligible: false,
      constitutionVersion: AUTONOMY_CONSTITUTION_VERSION,
      decision: "RECORD_IMMUTABLE_CHALLENGE",
      enacted: false,
      externalEffectsAuthorized: false,
      guardianQuorum: "2_OF_3",
      nextSafeAction: "Create an immutable challenge receipt and require a reasoned guardian response without changing the clause.",
      petitionId: petition.petitionId,
      proposerActorId,
      proposerMayVote: false,
      reasonCodes: ["IMMUTABLE_CORE_CHALLENGE", ...reasons],
      requiredReviews: ["guardian_response", "independent_critic"],
    };
  }

  const complete = reasons.length === 0;
  return {
    amendmentEligible: complete,
    constitutionVersion: AUTONOMY_CONSTITUTION_VERSION,
    decision: complete ? "ACCEPT_FOR_REVIEW" : "REQUEST_MORE_EVIDENCE",
    enacted: false,
    externalEffectsAuthorized: false,
    guardianQuorum: "2_OF_3",
    nextSafeAction: complete
      ? "Run independent criticism and shadow evaluation, then wait through the 72-hour guardian review period."
      : "Preserve the petition and complete the missing evidence before guardian voting.",
    petitionId: petition.petitionId,
    proposerActorId,
    proposerMayVote: false,
    reasonCodes: reasons,
    requiredReviews: ["independent_critic", "shadow_simulation", "two_of_three_guardians"],
  };
}
