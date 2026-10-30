import type { AuthoritativeCaseSnapshot, BoundEvidence } from "./service";

export type PartnerAccountProjection = {
  accountId: string;
  accountName: string;
  accountType: string;
  status: string | null;
  partnerIq: number | null;
  partnerIqVersion: string | null;
  partnerIqConfidence: string | null;
  updatedAt: string;
};

export type PartnerRelationshipCoverage = {
  professionals: { count: number; latestUpdatedAt: string | null };
  leads: { count: number; latestUpdatedAt: string | null };
  opportunities: { count: number; latestUpdatedAt: string | null };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARTNER_TYPES = new Set([
  "partner", "contractor", "developer", "design_firm", "architecture_firm",
  "owners_rep", "luxury_brokerage", "hospitality_owner_operator",
]);

function validTimestamp(value: string | null): boolean {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

// A projection version covers the account and relationship *summary* observed in one
// repeatable-read transaction; it is not a version of every CRM column or raw person.
export function projectPartnerCase(
  input: { account: PartnerAccountProjection; coverage: PartnerRelationshipCoverage; observedAt: string },
  digest: (value: unknown) => string,
): AuthoritativeCaseSnapshot {
  const { account, coverage, observedAt } = input;
  if (!UUID.test(account.accountId) || !account.accountName.trim() || !account.accountType.trim()) {
    throw new Error("PARTNER_ACCOUNT_IDENTITY_INVALID");
  }
  if (!validTimestamp(account.updatedAt) || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error("PARTNER_OBSERVATION_TIME_INVALID");
  }
  if (account.partnerIq !== null && (!Number.isFinite(account.partnerIq) || account.partnerIq < 0 || account.partnerIq > 100)) {
    throw new Error("PARTNER_IQ_INVALID");
  }
  for (const value of Object.values(coverage)) {
    if (!Number.isSafeInteger(value.count) || value.count < 0 || !validTimestamp(value.latestUpdatedAt)) {
      throw new Error("PARTNER_RELATIONSHIP_COVERAGE_INVALID");
    }
  }
  const snapshot = { account, coverage };
  const hash = digest(snapshot);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("PARTNER_VERSION_DIGEST_INVALID");
  const objectVersion = `partner-account:${account.accountId}:${hash}`;
  return {
    caseType: "PARTNER_RELATIONSHIP",
    objectVersion,
    observedAt,
    sourceOfTruth: "crm_accounts+crm_people+crm_leads+crm_opportunities",
    sourceRefs: [
      `postgres:public.crm_accounts/${account.accountId}@${objectVersion}`,
      `postgres:public.crm_people/account:${account.accountId}@${objectVersion}`,
      `postgres:public.crm_leads/account:${account.accountId}@${objectVersion}`,
      `postgres:public.crm_opportunities/account:${account.accountId}@${objectVersion}`,
    ],
    snapshot,
  };
}

export function partnerEvidence(observed: AuthoritativeCaseSnapshot, toolId: string): BoundEvidence {
  if (observed.caseType !== "PARTNER_RELATIONSHIP"
    || !["luzione.partner_relationship.read", "luzione.missing_evidence.read"].includes(toolId)) {
    return { freshness: "UNKNOWN", sourceRefs: [], evidence: {}, missingEvidence: ["supported partner evidence tool"] };
  }
  const snapshot = observed.snapshot as { account: PartnerAccountProjection; coverage: PartnerRelationshipCoverage };
  const missingEvidence: string[] = [];
  if (!PARTNER_TYPES.has(snapshot.account.accountType)) missingEvidence.push("verified partner classification");
  if (snapshot.account.partnerIq === null || !snapshot.account.partnerIqVersion) missingEvidence.push("current Partner IQ");
  if (snapshot.coverage.professionals.count + snapshot.coverage.leads.count === 0) {
    missingEvidence.push("linked professional or lead evidence");
  }
  return {
    freshness: "FRESH",
    sourceRefs: observed.sourceRefs,
    evidence: toolId === "luzione.missing_evidence.read"
      ? { account: snapshot.account, coverage: snapshot.coverage }
      : observed.snapshot,
    missingEvidence,
  };
}
