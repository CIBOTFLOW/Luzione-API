// Dependency-free, fail-closed safety contract for the disposable Partner RLS proof.
export const SOURCE_TABLES = Object.freeze([
  'crm_accounts', 'crm_people', 'crm_leads', 'crm_opportunities',
]);
export const DISPOSABLE_DB_PATTERN = /^sultan_rls_disposable_[a-z0-9_]{1,40}$/;

export function assertDisposableTarget(databaseName, confirmation, existingTables) {
  if (typeof databaseName !== 'string' || !DISPOSABLE_DB_PATTERN.test(databaseName)
    || confirmation !== 'I_CONFIRM_DISPOSABLE_ONLY') {
    throw new Error('DISPOSABLE_DATABASE_CONFIRMATION_REQUIRED');
  }
  if (!Array.isArray(existingTables) || existingTables.some(t => SOURCE_TABLES.includes(t))) {
    throw new Error('DISPOSABLE_DATABASE_NOT_EMPTY');
  }
  return true;
}

export function assertIsolationCounts(counts, tenant) {
  if (!counts || typeof counts !== 'object' || !SOURCE_TABLES.every(table =>
    counts[table] && Number.isSafeInteger(counts[table].own) && counts[table].own === 1
    && Number.isSafeInteger(counts[table].foreign) && counts[table].foreign === 0)) {
    throw new Error(`RLS_TENANT_ISOLATION_FAILED:${tenant}`);
  }
  return true;
}
