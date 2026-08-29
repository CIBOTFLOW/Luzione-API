import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260829010607_platform_control_plane_v2.sql"),
  "utf8",
);
const foreignKeyIndexes = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260829014227_platform_control_plane_fk_indexes.sql"),
  "utf8",
);
const connectionKillSwitchDefault = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260829014342_connection_kill_switch_default_safe.sql"),
  "utf8",
);
const sultanWorkloadIdentity = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260829023000_sultan_workload_identity.sql"),
  "utf8",
);
const p110PolicyAndApprovalIndex = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260829023500_p110_command_policy_and_approval_index.sql"),
  "utf8",
);

test("control-plane migration uses UUID tenancy, opaque secret refs, and authority-v2 preservation", () => {
  assert.match(migration, /tenant_memberships[\s\S]*tenant_id uuid not null references public\.tenant_accounts/);
  assert.match(migration, /secret_ref text/);
  assert.doesNotMatch(migration, /create table public\.integration_connections[\s\S]*access_token_encrypted/);
  assert.match(migration, /authority_contract_version = coalesce\(receipt\.authority_contract_version, 'luzione-authority\/v1'\)/);
  assert.match(migration, /authority_contract_version = 'luzione-authority\/v2'/);
  assert.match(migration, /authority_class <> 'A4' or state = 'BLOCKED'/);
});

test("every new control-plane table has RLS, FORCE RLS, revoke, and explicit service-role grants", () => {
  const tables = [
    "platform_object_ownership_registry",
    "tenant_legacy_id_mappings",
    "platform_identities",
    "tenant_memberships",
    "integration_capability_registry",
    "integration_connections",
    "integration_connection_capabilities",
    "integration_sync_runs",
    "integration_webhook_receipts",
    "platform_effect_approvals",
    "platform_usage_events",
    "tenant_budget_policies",
    "model_price_catalog",
    "tenant_secret_backend_settings",
  ];
  for (const table of tables) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role`));
    assert.match(migration, new RegExp(`grant [^;]+ on table public\\.${table} to service_role`));
  }
});

test("legacy provider credentials are migrated by opaque reference only", () => {
  assert.match(migration, /'legacy:connected_accounts\/' \|\| account\.id/);
  assert.match(migration, /'legacy:manual_connector_credentials\/' \|\| credential\.id/);
  assert.doesNotMatch(migration, /select[\s\S]{0,300}account\.access_token_encrypted/);
  assert.doesNotMatch(migration, /select[\s\S]{0,300}credential\.credential_fields_encrypted/);
});

test("the follow-up migration covers every control-plane foreign-key advisor finding", () => {
  for (const index of [
    "integration_connection_capabilities_provider_idx",
    "integration_connection_capabilities_updated_by_idx",
    "integration_connections_created_by_idx",
    "integration_webhook_receipts_tenant_connection_idx",
    "platform_effect_approvals_requested_by_idx",
    "platform_effect_approvals_approved_by_idx",
    "platform_usage_events_identity_idx",
    "platform_usage_events_tenant_connection_idx",
    "tenant_budget_policies_updated_by_idx",
    "tenant_secret_backend_settings_updated_by_idx",
  ]) {
    assert.match(foreignKeyIndexes, new RegExp(`create index ${index}`));
  }
});

test("connection kill switches default off while the independent global effect freeze remains application-gated", () => {
  assert.match(connectionKillSwitchDefault, /alter column kill_switch_active set default false/);
  assert.match(connectionKillSwitchDefault, /where state = 'LEGACY_MANAGED'/);
});

test("Sultan receives a tenant-bound least-authority workload membership", () => {
  assert.match(sultanWorkloadIdentity, /'agent:sultan-os', 'AGENT'/);
  assert.match(sultanWorkloadIdentity, /tenant\.code = 'LUZIONE_INTERNAL'/);
  assert.match(sultanWorkloadIdentity, /legacy\.legacy_tenant_id = 'luzione'/);
  assert.match(sultanWorkloadIdentity, /\["governance\.evaluate","models\.read","commands\.request"\]/);
  assert.doesNotMatch(sultanWorkloadIdentity, /connections\.manage|platform\.admin|effects\.execute/);
  assert.match(sultanWorkloadIdentity, /on conflict \(tenant_id, identity_id\) do nothing/);
});

test("the API-owned command table has its approval FK index and initplan-safe tenant policy", () => {
  assert.match(p110PolicyAndApprovalIndex, /p110_command_receipts_approval_idx/);
  assert.match(p110PolicyAndApprovalIndex, /approval_id is not null/);
  assert.match(p110PolicyAndApprovalIndex, /tenant_id = \(select current_setting\('app\.tenant_id', true\)\)/);
});
