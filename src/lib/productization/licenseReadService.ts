import "server-only";

import { databasePool } from "@/lib/db";
import { productModuleIds, type ProductModuleId } from "@/modules/productization/catalog";
import {
  licenseAccessModes,
  TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION,
  type LicenseAccessMode,
  type TenantLicenseSnapshot,
} from "@/modules/productization/licensing";

type LicenseRow = {
  edition_id: TenantLicenseSnapshot["editionId"];
  effective_at: Date | string;
  expires_at: Date | string | null;
  license_id: string;
  record_version: number | string;
  status: TenantLicenseSnapshot["status"];
};

type EntitlementRow = {
  access_mode: string;
  enabled: boolean;
  limits: unknown;
  module_id: string;
};

const editions = new Set<TenantLicenseSnapshot["editionId"]>([
  "AI_OCRMS",
  "IMPORT_OPERATIONS",
  "DESIGN_COMMERCE",
  "ENTERPRISE",
]);
const statuses = new Set<TenantLicenseSnapshot["status"]>([
  "TRIAL",
  "ACTIVE",
  "PAST_DUE",
  "SUSPENDED",
  "EXPIRED",
  "CANCELLED",
]);

function iso(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Canonical license timestamp is invalid.");
  return parsed.toISOString();
}

function limits(value: unknown): Readonly<Record<string, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Canonical module entitlement limits are invalid.");
  }
  const entries = Object.entries(value);
  if (!entries.every(([key, item]) => key.length > 0
    && key.length <= 100
    && Number.isSafeInteger(item)
    && Number(item) >= 0)) {
    throw new Error("Canonical module entitlement limits are invalid.");
  }
  return Object.freeze(Object.fromEntries(entries) as Record<string, number>);
}

function moduleId(value: string): ProductModuleId {
  if (!productModuleIds.includes(value as ProductModuleId)) {
    throw new Error("Canonical module entitlement references an unknown module.");
  }
  return value as ProductModuleId;
}

function accessMode(value: string): LicenseAccessMode {
  if (!licenseAccessModes.includes(value as LicenseAccessMode)) {
    throw new Error("Canonical module entitlement access mode is invalid.");
  }
  return value as LicenseAccessMode;
}

export async function readTenantLicenseSnapshot(input: {
  actorId: string;
  now?: Date;
  tenantId: string;
}): Promise<TenantLicenseSnapshot | null> {
  const client = await databasePool().connect();
  const now = input.now ?? new Date();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id', $1, true)", [input.tenantId]);
    await client.query("select set_config('app.actor_id', $1, true)", [input.actorId]);
    const licenseResult = await client.query<LicenseRow>(
      `select license_id, record_version, edition_id, status, effective_at, expires_at
         from public.tenant_product_license_versions
        where tenant_id = $1
          and exact_version_current
        limit 1`,
      [input.tenantId],
    );
    const license = licenseResult.rows[0];
    if (!license) {
      await client.query("commit");
      return null;
    }
    if (!editions.has(license.edition_id) || !statuses.has(license.status)) {
      throw new Error("Canonical tenant license enum is invalid.");
    }
    const recordVersion = Number(license.record_version);
    if (!Number.isSafeInteger(recordVersion) || recordVersion < 1) {
      throw new Error("Canonical tenant license version is invalid.");
    }
    const entitlementResult = await client.query<EntitlementRow>(
      `select entitlement.module_id, entitlement.enabled,
              entitlement.access_mode, entitlement.limits
         from public.tenant_product_module_entitlements entitlement
         join public.tenant_product_license_versions license
           on license.tenant_id = entitlement.tenant_id
          and license.license_version_id = entitlement.license_version_id
        where entitlement.tenant_id = $1
          and license.license_id = $2
          and license.record_version = $3
          and license.exact_version_current
        order by entitlement.module_id`,
      [input.tenantId, license.license_id, recordVersion],
    );
    await client.query("commit");
    const observedAt = now.toISOString();
    return {
      contractVersion: TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION,
      editionId: license.edition_id,
      effectiveAt: iso(license.effective_at),
      expiresAt: license.expires_at === null ? null : iso(license.expires_at),
      integrity: "VERIFIED_CANONICAL_STORE",
      licenseId: license.license_id,
      licenseVersion: recordVersion,
      moduleEntitlements: Object.freeze(entitlementResult.rows.map((entitlement) => ({
        accessMode: accessMode(entitlement.access_mode),
        enabled: entitlement.enabled,
        limits: limits(entitlement.limits),
        moduleId: moduleId(entitlement.module_id),
      }))),
      observedAt,
      snapshotExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
      status: license.status,
      tenantId: input.tenantId,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
