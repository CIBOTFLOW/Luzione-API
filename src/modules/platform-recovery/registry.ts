export const PLATFORM_RECOVERY_CONTRACT_VERSION = "luzione-recovery-registry/v1";

export type RecoveryEvidenceState =
  | "DECLARED_UNVERIFIED"
  | "DISPOSABLE_LOCAL_PROVEN"
  | "PRODUCTION_RESTORE_PROVEN";

export type RecoveryScope = {
  authoritativeOwner: string;
  backupMechanism: string;
  contingency: string;
  evidenceRefs: readonly string[];
  evidenceState: RecoveryEvidenceState;
  forwardRepair: string;
  integrityChecks: readonly string[];
  recoveryScopeId: string;
  restoreOwner: string;
  restoreProcedureRef: string;
  rollbackStrategy: string;
  rpoTargetMinutes: number;
  rtoTargetMinutes: number;
  truthScope: readonly string[];
};

export const recoveryRegistry: readonly RecoveryScope[] = Object.freeze([
  {
    authoritativeOwner: "Luzione canonical data owner with managed Postgres provider",
    backupMechanism: "Managed backup/PITR posture required by policy; provider configuration is outside this repository and unverified.",
    contingency: "If managed restore evidence is unavailable, block stronger SLA and production-readiness claims.",
    evidenceRefs: ["docs/compliance/BACKUP_AND_RECOVERY.md", "docs/runbooks/DATABASE_AND_RLS.md"],
    evidenceState: "DECLARED_UNVERIFIED",
    forwardRepair: "Apply reviewed additive migrations only after restored-clone compatibility proof.",
    integrityChecks: ["catalog/table row-count fingerprint", "function/index/policy counts", "migration history", "RLS denial probes", "critical provider reconciliation"],
    recoveryScopeId: "canonical-postgres",
    restoreOwner: "Luzione database and security owner",
    restoreProcedureRef: "docs/runbooks/POSTGRES_RESTORE_DRILL.md",
    rollbackStrategy: "Return traffic to the prior verified database endpoint or restore point; never mutate the failed source during rehearsal.",
    rpoTargetMinutes: 1_440,
    rtoTargetMinutes: 480,
    truthScope: ["canonical application records", "platform contracts/receipts/checkpoints", "API-owned projections"],
  },
  {
    authoritativeOwner: "Shopify source owner; Luzione API owns only the P113 projection",
    backupMechanism: "Provider-authoritative source plus rebuildable canonical Postgres projection and sync ledger.",
    contingency: "Disable quote eligibility and rebuild only from authenticated source observations when projection evidence drifts.",
    evidenceRefs: ["src/modules/platform-contracts/truthRegistry.ts", "docs/runbooks/P113_CATALOG_PROJECTION.md"],
    evidenceState: "DISPOSABLE_LOCAL_PROVEN",
    forwardRepair: "Replay versioned P113 observations through the idempotent projection boundary.",
    integrityChecks: ["source count", "accepted count", "cursor/version", "mapping contract", "quote eligibility"],
    recoveryScopeId: "shopify-p113-projection",
    restoreOwner: "Luzione catalog projection owner",
    restoreProcedureRef: "docs/runbooks/P113_CATALOG_PROJECTION.md",
    rollbackStrategy: "Discard/rebuild the projection; never use it to overwrite Shopify.",
    rpoTargetMinutes: 2_880,
    rtoTargetMinutes: 480,
    truthScope: ["P113 Shopify catalog read model"],
  },
]);

export function recoveryRegistryViolations(
  entries: readonly RecoveryScope[] = recoveryRegistry,
) {
  const violations: string[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.recoveryScopeId)) violations.push(`duplicate:${entry.recoveryScopeId}`);
    ids.add(entry.recoveryScopeId);
    if (entry.rpoTargetMinutes <= 0 || entry.rtoTargetMinutes <= 0) violations.push(`objective:${entry.recoveryScopeId}`);
    if (!entry.integrityChecks.length || !entry.truthScope.length) violations.push(`incomplete:${entry.recoveryScopeId}`);
    if (entry.evidenceState === "PRODUCTION_RESTORE_PROVEN") violations.push(`unsupported-production-proof:${entry.recoveryScopeId}`);
  }
  return violations;
}
