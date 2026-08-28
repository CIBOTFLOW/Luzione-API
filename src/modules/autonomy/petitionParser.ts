import { constitutionalScopes, type ConstitutionalPetition } from "./types";
import { AutonomyRequestError } from "./parser";

type JsonObject = Record<string, unknown>;

const BODY_KEYS = new Set(["petition"]);
const PETITION_KEYS = new Set([
  "acknowledgesUncertainty",
  "counterarguments",
  "evidenceRefs",
  "petitionId",
  "proposedText",
  "rationale",
  "rollbackPlan",
  "scope",
  "simulationRefs",
  "targetClauseId",
]);

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AutonomyRequestError("INVALID_REQUEST", `${label} must be an object.`);
  }
  return value as JsonObject;
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
  return value.map((item, index) => text(item, `${label}[${index}]`, 500));
}

export function parseConstitutionalPetitionRequest(value: unknown): ConstitutionalPetition {
  const body = object(value, "request");
  const bodyAuthority = Object.keys(body).find((key) =>
    ["actor", "approved", "authority", "enacted", "guardianVotes", "tenantId"].includes(key));
  if (bodyAuthority) {
    throw new AutonomyRequestError("CLIENT_AUTHORITY_REJECTED", `request.${bodyAuthority} cannot be supplied by a client.`);
  }
  const unknownBody = Object.keys(body).find((key) => !BODY_KEYS.has(key));
  if (unknownBody) throw new AutonomyRequestError("INVALID_REQUEST", `request.${unknownBody} is not supported.`);
  const petition = object(body.petition, "petition");
  const authority = Object.keys(petition).find((key) =>
    ["approved", "enacted", "guardianVotes", "proposedBy", "tenantId"].includes(key));
  if (authority) {
    throw new AutonomyRequestError("CLIENT_AUTHORITY_REJECTED", `petition.${authority} cannot be supplied by a client.`);
  }
  const unknown = Object.keys(petition).find((key) => !PETITION_KEYS.has(key));
  if (unknown) throw new AutonomyRequestError("INVALID_REQUEST", `petition.${unknown} is not supported.`);
  if (!constitutionalScopes.includes(petition.scope as never)) {
    throw new AutonomyRequestError("INVALID_REQUEST", "petition.scope is invalid.");
  }
  if (typeof petition.acknowledgesUncertainty !== "boolean") {
    throw new AutonomyRequestError("INVALID_REQUEST", "petition.acknowledgesUncertainty must be boolean.");
  }
  return {
    acknowledgesUncertainty: petition.acknowledgesUncertainty,
    counterarguments: strings(petition.counterarguments, "petition.counterarguments", 20),
    evidenceRefs: strings(petition.evidenceRefs, "petition.evidenceRefs", 50),
    petitionId: text(petition.petitionId, "petition.petitionId", 160),
    proposedText: text(petition.proposedText, "petition.proposedText", 4000),
    rationale: text(petition.rationale, "petition.rationale", 4000),
    rollbackPlan: text(petition.rollbackPlan, "petition.rollbackPlan", 2000),
    scope: petition.scope as ConstitutionalPetition["scope"],
    simulationRefs: strings(petition.simulationRefs, "petition.simulationRefs", 50),
    targetClauseId: text(petition.targetClauseId, "petition.targetClauseId", 160),
  };
}
