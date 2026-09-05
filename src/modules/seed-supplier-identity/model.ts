import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { SupplierCapability, SupplierProfileStatus, SupplierProfileTransitionAction } from "@/modules/seed-supplier-identity/contracts";

export function isCanonicalSupplierIdentityInstant(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

export function supplierProfileIdFor(tenantId: string, accountId: string) {
  return `supplier_profile_${sha256({ accountId, tenantId }).slice(0, 40)}`;
}

export function supplierProfileVersion(profileId: string, version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Supplier Profile version must be a positive integer.");
  return `supplier-profile:${profileId}:v${version}`;
}

export function accountVersionRef(accountId: string, version: unknown) {
  const token = String(version);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(token)) throw new Error("Canonical Account version is invalid.");
  return `account:${accountId}:v${token}`;
}

export function nextSupplierProfileStatus(input: {
  action: SupplierProfileTransitionAction;
  currentStatus: SupplierProfileStatus;
  hasIdentityConflict: boolean;
  requestedAt: string;
  validUntil: string;
}): SupplierProfileStatus {
  const { action, currentStatus } = input;
  if (!isCanonicalSupplierIdentityInstant(input.requestedAt) || !isCanonicalSupplierIdentityInstant(input.validUntil)) throw new Error("Supplier transition timestamps must be real canonical RFC3339 UTC instants.");
  if (action === "ACTIVATE") {
    if (currentStatus !== "PROPOSED") throw new Error("Only a proposed Supplier Profile can be activated.");
    if (input.hasIdentityConflict) throw new Error("Supplier identity conflicts must be resolved before activation.");
    if (Date.parse(input.requestedAt) >= Date.parse(input.validUntil)) throw new Error("An expired Supplier Profile cannot be activated.");
    return "ELIGIBLE";
  }
  if (action === "SUSPEND") {
    if (currentStatus !== "ELIGIBLE") throw new Error("Only an eligible Supplier Profile can be suspended.");
    return "SUSPENDED";
  }
  if (action === "EXPIRE") {
    if (currentStatus !== "ELIGIBLE" && currentStatus !== "SUSPENDED") throw new Error("Only an eligible or suspended Supplier Profile can expire.");
    if (Date.parse(input.requestedAt) < Date.parse(input.validUntil)) throw new Error("Supplier Profile cannot expire before validUntil.");
    return "EXPIRED";
  }
  if (action === "REVOKE") {
    if (currentStatus === "ARCHIVED" || currentStatus === "REVOKED") throw new Error("Archived or revoked Supplier Profile cannot be revoked again.");
    return "REVOKED";
  }
  if (currentStatus === "ARCHIVED") throw new Error("Supplier Profile is already archived.");
  return "ARCHIVED";
}

export function supplierEligibilityDefects(input: {
  accountVersionActual: string;
  accountVersionExpected: string;
  capability: SupplierCapability;
  capabilities: readonly SupplierCapability[];
  observedAt: string;
  status: SupplierProfileStatus;
  validFrom: string;
  validUntil: string;
}) {
  const defects: string[] = [];
  if (input.accountVersionActual !== input.accountVersionExpected) defects.push("ACCOUNT_VERSION_STALE");
  if (input.status !== "ELIGIBLE") defects.push("SUPPLIER_NOT_ELIGIBLE");
  if (!input.capabilities.includes(input.capability)) defects.push("CAPABILITY_NOT_APPROVED");
  if (!isCanonicalSupplierIdentityInstant(input.observedAt) || !isCanonicalSupplierIdentityInstant(input.validFrom) || !isCanonicalSupplierIdentityInstant(input.validUntil)) defects.push("INVALID_VALIDITY_TIMESTAMP");
  else {
    const observed = Date.parse(input.observedAt);
    if (Date.parse(input.validUntil) <= Date.parse(input.validFrom) || observed < Date.parse(input.validFrom) || observed >= Date.parse(input.validUntil)) defects.push("VALIDITY_WINDOW_CLOSED");
  }
  return defects;
}

export function supplierIdentityKnownBadDefects(input: {
  actualVersion: string;
  expectedVersion: string;
  query: string;
  humanActorId: string | null;
  proposalActorId: string;
}) {
  const defects: string[] = [];
  if (!/(?:\b|\.)tenant_id\s*=\s*\$1\b/i.test(input.query)) defects.push("TENANT_PREDICATE_MISSING");
  if (input.actualVersion !== input.expectedVersion) defects.push("STALE_VERSION_ACCEPTED");
  if (!input.humanActorId || input.humanActorId === input.proposalActorId) defects.push("PORTAL_SELF_APPROVAL_ACCEPTED");
  return defects;
}
