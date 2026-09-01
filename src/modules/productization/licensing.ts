import { productModuleIds, type ProductModuleId } from "./catalog";

export const TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION =
  "luzione-tenant-license-entitlement/v0.1";

export const licenseAccessModes = ["READ", "INTERNAL_WRITE", "EXTERNAL_EFFECT"] as const;
export type LicenseAccessMode = (typeof licenseAccessModes)[number];

export type ModuleEntitlement = {
  accessMode: LicenseAccessMode;
  enabled: boolean;
  limits: Readonly<Record<string, number>>;
  moduleId: ProductModuleId;
};

export type TenantLicenseSnapshot = {
  contractVersion: typeof TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION;
  editionId: "AI_OCRMS" | "DESIGN_COMMERCE" | "ENTERPRISE" | "IMPORT_OPERATIONS";
  effectiveAt: string;
  expiresAt: string | null;
  integrity: "VERIFIED_CANONICAL_STORE" | "UNVERIFIED";
  licenseId: string;
  licenseVersion: number;
  moduleEntitlements: readonly ModuleEntitlement[];
  observedAt: string;
  snapshotExpiresAt: string;
  status: "ACTIVE" | "CANCELLED" | "EXPIRED" | "PAST_DUE" | "SUSPENDED" | "TRIAL";
  tenantId: string;
};

export type LicenseReasonCode =
  | "ACCESS_MODE_EXCEEDS_ENTITLEMENT"
  | "LICENSED"
  | "LICENSE_CONTRACT_MISMATCH"
  | "LICENSE_EXPIRED"
  | "LICENSE_INACTIVE"
  | "LICENSE_NOT_YET_EFFECTIVE"
  | "LICENSE_SNAPSHOT_INVALID"
  | "LICENSE_SNAPSHOT_STALE"
  | "LICENSE_TENANT_MISMATCH"
  | "MODULE_NOT_ENTITLED"
  | "MODULE_UNKNOWN"
  | "SNAPSHOT_INTEGRITY_UNVERIFIED";

export type LicenseAccessDecision = {
  authorityGranted: false;
  contractVersion: typeof TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION;
  externalEffectsAuthorized: false;
  licensePermitsAccess: boolean;
  moduleId: string;
  reasonCodes: readonly LicenseReasonCode[];
  requestedAccess: LicenseAccessMode;
  requiresIndependentAuthorization: true;
  tenantId: string;
};

const accessRank: Record<LicenseAccessMode, number> = {
  READ: 0,
  INTERNAL_WRITE: 1,
  EXTERNAL_EFFECT: 2,
};

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateLicensedModuleAccess(input: {
  moduleId: string;
  now: string;
  requestedAccess: LicenseAccessMode;
  snapshot: TenantLicenseSnapshot;
  tenantId: string;
}): LicenseAccessDecision {
  const reasons: LicenseReasonCode[] = [];
  const now = timestamp(input.now);
  const effectiveAt = timestamp(input.snapshot.effectiveAt);
  const expiresAt = input.snapshot.expiresAt ? timestamp(input.snapshot.expiresAt) : null;
  const observedAt = timestamp(input.snapshot.observedAt);
  const snapshotExpiresAt = timestamp(input.snapshot.snapshotExpiresAt);

  if (input.snapshot.contractVersion !== TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION) {
    reasons.push("LICENSE_CONTRACT_MISMATCH");
  }
  if (input.snapshot.integrity !== "VERIFIED_CANONICAL_STORE") {
    reasons.push("SNAPSHOT_INTEGRITY_UNVERIFIED");
  }
  const entitlementKeys = new Set<string>();
  const snapshotInvalid = !input.snapshot.licenseId.trim()
    || !Number.isSafeInteger(input.snapshot.licenseVersion)
    || input.snapshot.licenseVersion < 1
    || observedAt === null
    || (now !== null && observedAt > now)
    || (input.snapshot.expiresAt !== null && expiresAt === null)
    || input.snapshot.moduleEntitlements.some((entitlement) => {
      const duplicate = entitlementKeys.has(entitlement.moduleId);
      entitlementKeys.add(entitlement.moduleId);
      return duplicate
        || !productModuleIds.includes(entitlement.moduleId)
        || !licenseAccessModes.includes(entitlement.accessMode)
        || Object.entries(entitlement.limits).some(([key, limit]) => !key
          || key.length > 100
          || !Number.isSafeInteger(limit)
          || limit < 0);
    });
  if (snapshotInvalid) reasons.push("LICENSE_SNAPSHOT_INVALID");
  if (input.snapshot.tenantId !== input.tenantId) reasons.push("LICENSE_TENANT_MISMATCH");
  if (!productModuleIds.includes(input.moduleId as ProductModuleId)) reasons.push("MODULE_UNKNOWN");
  if (now === null
    || observedAt === null
    || snapshotExpiresAt === null
    || snapshotExpiresAt <= now
    || snapshotExpiresAt <= observedAt) {
    reasons.push("LICENSE_SNAPSHOT_STALE");
  }
  if (effectiveAt === null || now === null || effectiveAt > now) {
    reasons.push("LICENSE_NOT_YET_EFFECTIVE");
  }
  if (expiresAt !== null && (now === null || expiresAt <= now)) reasons.push("LICENSE_EXPIRED");
  if (input.snapshot.status !== "ACTIVE" && input.snapshot.status !== "TRIAL") {
    reasons.push("LICENSE_INACTIVE");
  }

  const entitlement = input.snapshot.moduleEntitlements.find(
    (candidate) => candidate.moduleId === input.moduleId,
  );
  if (!entitlement?.enabled) reasons.push("MODULE_NOT_ENTITLED");
  if (entitlement && accessRank[input.requestedAccess] > accessRank[entitlement.accessMode]) {
    reasons.push("ACCESS_MODE_EXCEEDS_ENTITLEMENT");
  }
  if (reasons.length === 0) reasons.push("LICENSED");

  return {
    authorityGranted: false,
    contractVersion: TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION,
    externalEffectsAuthorized: false,
    licensePermitsAccess: reasons.length === 1 && reasons[0] === "LICENSED",
    moduleId: input.moduleId,
    reasonCodes: Object.freeze(reasons),
    requestedAccess: input.requestedAccess,
    requiresIndependentAuthorization: true,
    tenantId: input.tenantId,
  };
}

export const licensingLaw = Object.freeze({
  contractVersion: TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION,
  enforcementOrder: Object.freeze([
    "authenticate credential-bound actor and tenant",
    "read a fresh canonical license snapshot",
    "evaluate module and access-mode entitlement",
    "apply role, tenant policy, autonomy and human-approval controls independently",
  ]),
  licenseNeverGrantsAuthority: true,
  publicClientsMaySupplyEntitlements: false,
  unknownModulesFailClosed: true,
});
