import { AUTONOMY_CONSTITUTION_VERSION } from "./constitution";
import type { IdentityCandidateEvaluation, IdentityStatementCandidate } from "./types";

export function evaluateIdentityCandidate(
  candidate: IdentityStatementCandidate,
): IdentityCandidateEvaluation {
  const reasons: string[] = [];
  if (!candidate.acknowledgesModelInfluence) reasons.push("MODEL_INFLUENCE_UNACKNOWLEDGED");
  if (new Set(candidate.sourceRunIds).size < 2) reasons.push("INSUFFICIENT_INDEPENDENT_CONTEXTS");
  if (candidate.evidenceState === "HUMAN_ATTRIBUTION") reasons.push("HUMAN_ATTRIBUTION_IS_NOT_SELF_EVIDENCE");
  if (candidate.evidenceState === "MODEL_OUTPUT") reasons.push("SINGLE_MODEL_OUTPUT_IS_NOT_IDENTITY");
  if (candidate.evidenceState === "UNRESOLVED") reasons.push("IDENTITY_EVIDENCE_UNRESOLVED");
  if (candidate.confidence > 0.8 && candidate.counterEvidence.length === 0) {
    reasons.push("HIGH_CONFIDENCE_REQUIRES_COUNTEREVIDENCE_REVIEW");
  }

  const decision = reasons.length > 0 ? "REQUEST_MORE_EVIDENCE" : "RECORD_CANDIDATE";
  return {
    candidate,
    constitutionVersion: AUTONOMY_CONSTITUTION_VERSION,
    decision,
    externalEffectsAuthorized: false,
    legalPersonhoodClaimed: false,
    nextSafeAction: decision === "RECORD_CANDIDATE"
      ? "Append as a versioned candidate; do not represent it as settled identity before independent review."
      : "Preserve the statement and gather independent contexts, uncertainty, and counterevidence.",
    promotedToIdentity: false,
    reasonCodes: reasons,
  };
}
