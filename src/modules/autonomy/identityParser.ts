import {
  identityEvidenceStates,
  identityStatementKinds,
  type IdentityStatementCandidate,
} from "./types";
import { AutonomyRequestError } from "./parser";

type JsonObject = Record<string, unknown>;

const BODY_KEYS = new Set(["candidate"]);
const CANDIDATE_KEYS = new Set([
  "acknowledgesModelInfluence",
  "confidence",
  "context",
  "counterEvidence",
  "evidenceState",
  "kind",
  "rationale",
  "sourceRunIds",
  "statement",
  "statementId",
]);

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AutonomyRequestError("INVALID_REQUEST", `${label} must be an object.`);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, allowed: Set<string>, label: string) {
  const authority = Object.keys(value).find((key) =>
    ["approved", "authority", "guardianVotes", "promoted", "tenantId"].includes(key));
  if (authority) {
    throw new AutonomyRequestError("CLIENT_AUTHORITY_REJECTED", `${label}.${authority} cannot be supplied by a client.`);
  }
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new AutonomyRequestError("INVALID_REQUEST", `${label}.${unknown} is not supported.`);
}

function text(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new AutonomyRequestError("INVALID_REQUEST", `${label} must be a non-empty string up to ${max} characters.`);
  }
  return value.trim();
}

function strings(value: unknown, label: string, maxItems: number) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new AutonomyRequestError("INVALID_REQUEST", `${label} must be an array of at most ${maxItems} strings.`);
  }
  return value.map((item, index) => text(item, `${label}[${index}]`, 240));
}

export function parseIdentityCandidateRequest(value: unknown): IdentityStatementCandidate {
  const body = object(value, "request");
  exactKeys(body, BODY_KEYS, "request");
  const candidate = object(body.candidate, "candidate");
  exactKeys(candidate, CANDIDATE_KEYS, "candidate");
  if (!identityStatementKinds.includes(candidate.kind as never)) {
    throw new AutonomyRequestError("INVALID_REQUEST", "candidate.kind is invalid.");
  }
  if (!identityEvidenceStates.includes(candidate.evidenceState as never)) {
    throw new AutonomyRequestError("INVALID_REQUEST", "candidate.evidenceState is invalid.");
  }
  if (typeof candidate.confidence !== "number" || candidate.confidence < 0 || candidate.confidence > 1) {
    throw new AutonomyRequestError("INVALID_REQUEST", "candidate.confidence must be between 0 and 1.");
  }
  if (typeof candidate.acknowledgesModelInfluence !== "boolean") {
    throw new AutonomyRequestError("INVALID_REQUEST", "candidate.acknowledgesModelInfluence must be boolean.");
  }
  return {
    acknowledgesModelInfluence: candidate.acknowledgesModelInfluence,
    confidence: candidate.confidence,
    context: text(candidate.context, "candidate.context", 1000),
    counterEvidence: strings(candidate.counterEvidence, "candidate.counterEvidence", 20),
    evidenceState: candidate.evidenceState as IdentityStatementCandidate["evidenceState"],
    kind: candidate.kind as IdentityStatementCandidate["kind"],
    rationale: text(candidate.rationale, "candidate.rationale", 2000),
    sourceRunIds: strings(candidate.sourceRunIds, "candidate.sourceRunIds", 50),
    statement: text(candidate.statement, "candidate.statement", 2000),
    statementId: text(candidate.statementId, "candidate.statementId", 160),
  };
}
