export const TABLE_OBJECT_REGISTRY_VERSION = "luzione-table-object-registry/v1";

export const TABLE_OBJECT_REGISTRY_SOURCE_VERSION =
  "CIBOTFLOW/Luzione-UI@d6b23f6f97ac065b6af3572ab010c478ae9d9b24:repo_150_browser_privilege_and_crm_identity_convergence_20260831";

export type TableObjectAuthorityStatus =
  | "CAPABILITY_OWNER_APPROVED"
  | "REJECTED"
  | "UNCONFIRMED";

export type TableObjectDataRole =
  | "CANONICAL"
  | "INTEGRATION"
  | "LEDGER"
  | "PROJECTION"
  | "TEMPORARY"
  | "UNCLASSIFIED";

export type TableObjectLifecycle = "ACTIVE" | "QUARANTINED" | "RETIRED" | "REVIEW";

export type TableObjectDescriptor = {
  authorityStatus: TableObjectAuthorityStatus;
  canonicalSuccessor: string | null;
  capabilityOwner: string;
  dataRole: TableObjectDataRole;
  domain: string;
  evidenceRefs: readonly string[];
  freshness: {
    maxAgeSeconds: number | null;
    observedAt: string;
    status: "SNAPSHOT_ONLY";
  };
  lifecycle: TableObjectLifecycle;
  physicalSchemaOwner: string;
  projectionOf: string | null;
  qualifiedName: string;
  reconciliationPosture: {
    source: string;
    status: "SOURCE_SNAPSHOT_REQUIRED";
    strategy: "REFRESH_FROM_PRODUCTION_METADATA";
  };
  retirementGate: {
    allowed: boolean;
    requiredEvidence: readonly string[];
  };
  securityPosture: {
    anonAccess: false;
    authenticatedAccess: true;
    browserBoundary: "AUTHENTICATED_RLS";
    policyCount: number;
    rls: "ENABLED";
    serviceRoleAccess: true;
  };
  sourceVersion: string;
};

const SOURCE_SNAPSHOT =
  "CIBOTFLOW/Luzione-UI:architecture/data/table-estate/production-registry-2026-08-31.json";
const SOURCE_OBSERVED_AT = "2026-08-31T04:16:58.706Z";
const SUPPLIER_PORTAL_OWNER = "CIBOTFLOW/Luzione-Supplier-Portal";
const UI_SCHEMA_OWNER = "CIBOTFLOW/Luzione-UI";

const evidenceRefs = Object.freeze([
  `${SOURCE_SNAPSHOT}@d6b23f6f97ac065b6af3572ab010c478ae9d9b24`,
  "CIBOTFLOW/Luzione-UI:packages/db-schema/150_browser_privilege_and_crm_identity_convergence.sql@177959c88d3267712cd3780934cd56423298366d",
  "production:supabase:repo_150_browser_privilege_and_crm_identity_convergence_20260831",
]);

const retirementEvidence = Object.freeze([
  "capability-owner approval",
  "repository-reference scan at an exact source version",
  "recurring production activity snapshots spanning the approved observation window",
  "inbound dependency and consumer inventory",
  "reversible quarantine simulation with readback",
  "rollback plan and post-change authoritative observation",
]);

function supplierPortalSurface(
  tableName: string,
  dataRole: TableObjectDataRole,
  policyCount: number,
): TableObjectDescriptor {
  return {
    authorityStatus: "CAPABILITY_OWNER_APPROVED",
    canonicalSuccessor: null,
    capabilityOwner: SUPPLIER_PORTAL_OWNER,
    dataRole,
    domain: "supplier-portal",
    evidenceRefs,
    freshness: {
      maxAgeSeconds: null,
      observedAt: SOURCE_OBSERVED_AT,
      status: "SNAPSHOT_ONLY",
    },
    lifecycle: "REVIEW",
    physicalSchemaOwner: UI_SCHEMA_OWNER,
    projectionOf: null,
    qualifiedName: `public.${tableName}`,
    reconciliationPosture: {
      source: SOURCE_SNAPSHOT,
      status: "SOURCE_SNAPSHOT_REQUIRED",
      strategy: "REFRESH_FROM_PRODUCTION_METADATA",
    },
    retirementGate: {
      allowed: false,
      requiredEvidence: retirementEvidence,
    },
    securityPosture: {
      anonAccess: false,
      authenticatedAccess: true,
      browserBoundary: "AUTHENTICATED_RLS",
      policyCount,
      rls: "ENABLED",
      serviceRoleAccess: true,
    },
    sourceVersion: TABLE_OBJECT_REGISTRY_SOURCE_VERSION,
  };
}

export const tableObjectRegistry: readonly TableObjectDescriptor[] = Object.freeze([
  supplierPortalSurface("portal_activity_events", "LEDGER", 1),
  supplierPortalSurface("portal_command_receipts", "LEDGER", 1),
  supplierPortalSurface("portal_designer_catalog_items", "UNCLASSIFIED", 1),
  supplierPortalSurface("portal_designer_issue_proposals", "UNCLASSIFIED", 2),
  supplierPortalSurface("portal_designer_order_snapshots", "PROJECTION", 1),
  supplierPortalSurface("portal_designer_update_commands", "UNCLASSIFIED", 2),
  supplierPortalSurface("portal_lead_partner_identities", "UNCLASSIFIED", 1),
  supplierPortalSurface("portal_memberships", "UNCLASSIFIED", 1),
  supplierPortalSurface("portal_object_grants", "UNCLASSIFIED", 1),
  supplierPortalSurface("portal_package_line_allocations", "UNCLASSIFIED", 2),
  supplierPortalSurface("portal_package_versions", "UNCLASSIFIED", 2),
  supplierPortalSurface("portal_partner_organizations", "UNCLASSIFIED", 1),
  supplierPortalSurface("portal_product_logistics_versions", "UNCLASSIFIED", 2),
  supplierPortalSurface("portal_profiles", "UNCLASSIFIED", 1),
  supplierPortalSurface("portal_quote_request_lines", "UNCLASSIFIED", 2),
  supplierPortalSurface("portal_quote_requests", "UNCLASSIFIED", 2),
  supplierPortalSurface("portal_shipment_assignments", "UNCLASSIFIED", 1),
  supplierPortalSurface("portal_shipments", "UNCLASSIFIED", 1),
  supplierPortalSurface("portal_supplier_assignments", "UNCLASSIFIED", 1),
  supplierPortalSurface("portal_supplier_payable_snapshots", "PROJECTION", 1),
  supplierPortalSurface("portal_supplier_update_commands", "UNCLASSIFIED", 2),
  supplierPortalSurface("portal_trade_document_versions", "UNCLASSIFIED", 2),
]);

export const tableObjectRegistryCoverage = Object.freeze({
  browserSurfaceCount: 22,
  declaredObjectCount: tableObjectRegistry.length,
  declarationScope: "SUPPLIER_PORTAL_BROWSER_SURFACES" as const,
  fullEstateMapped: false,
  metadataOnly: true,
  observedEstateTableCount: 713,
  sourceObservedAt: SOURCE_OBSERVED_AT,
  sourceVersion: TABLE_OBJECT_REGISTRY_SOURCE_VERSION,
  tableContentsRead: false,
  undeclaredObjectCount: 713 - tableObjectRegistry.length,
});

const authorityStatuses = new Set<TableObjectAuthorityStatus>([
  "CAPABILITY_OWNER_APPROVED",
  "REJECTED",
  "UNCONFIRMED",
]);
const dataRoles = new Set<TableObjectDataRole>([
  "CANONICAL",
  "INTEGRATION",
  "LEDGER",
  "PROJECTION",
  "TEMPORARY",
  "UNCLASSIFIED",
]);
const lifecycles = new Set<TableObjectLifecycle>([
  "ACTIVE",
  "QUARANTINED",
  "RETIRED",
  "REVIEW",
]);

export function tableObjectRegistryViolations(
  entries: readonly TableObjectDescriptor[] = tableObjectRegistry,
) {
  const violations: string[] = [];
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = entry.qualifiedName;
    if (identities.has(identity)) violations.push(`duplicate:${identity}`);
    identities.add(identity);
    if (!/^public\.[a-z][a-z0-9_]{0,62}$/.test(identity)) {
      violations.push(`invalid-qualified-name:${identity}`);
    }
    if (!authorityStatuses.has(entry.authorityStatus)) {
      violations.push(`unknown-authority-status:${identity}`);
    }
    if (!dataRoles.has(entry.dataRole)) violations.push(`unknown-data-role:${identity}`);
    if (!lifecycles.has(entry.lifecycle)) violations.push(`unknown-lifecycle:${identity}`);
    if (!entry.sourceVersion || entry.evidenceRefs.length === 0) {
      violations.push(`missing-evidence:${identity}`);
    }
    if (entry.authorityStatus === "CAPABILITY_OWNER_APPROVED" && !entry.capabilityOwner) {
      violations.push(`approved-without-owner:${identity}`);
    }
    if (entry.securityPosture.anonAccess || !entry.securityPosture.authenticatedAccess ||
      entry.securityPosture.rls !== "ENABLED" || entry.securityPosture.policyCount < 1) {
      violations.push(`unsafe-browser-boundary:${identity}`);
    }
    if (entry.retirementGate.allowed &&
      (entry.lifecycle !== "RETIRED" || !entry.canonicalSuccessor)) {
      violations.push(`unsafe-retirement:${identity}`);
    }
  }
  return violations;
}
