import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stage5Migration = readFileSync(
  "supabase/migrations/20260902010000_sultan_stage5_authority_outcomes.sql",
  "utf8",
);
const postInferenceConstraintMigration = readFileSync(
  "supabase/migrations/20260902010100_sultan_stage5_post_inference_receipt_constraints.sql",
  "utf8",
);
const policyMigration = readFileSync(
  "supabase/migrations/20260901123000_sultan_agent_policy_envelopes.sql",
  "utf8",
);
const actionMigration = readFileSync(
  "supabase/migrations/20260901130000_sultan_agent_internal_actions.sql",
  "utf8",
);
const disposableRehearsal = readFileSync("scripts/validation/sultan-stage5-rehearsal.ts", "utf8");
const managedRehearsal = readFileSync("scripts/validation/sultan-stage5-managed-rehearsal.sql", "utf8");

const STAGE5_TABLES = [
  "sultan_stage5_idempotency_conflicts",
  "sultan_canonical_readback_receipts",
  "sultan_api_admission_receipts",
  "sultan_outcome_observations",
] as const;

test("Stage 5 receipt tables force tenant RLS and expose only bounded runtime insertion", () => {
  for (const table of STAGE5_TABLES) {
    assert.match(stage5Migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(stage5Migration, new RegExp(`alter table public\\.${table} force row level security`));
  }
  assert.match(postInferenceConstraintMigration, /alter table public\.sultan_api_admission_evidence_refs enable row level security/);
  assert.match(postInferenceConstraintMigration, /alter table public\.sultan_api_admission_evidence_refs force row level security/);
  assert.match(postInferenceConstraintMigration, /grant select, insert on public\.sultan_api_admission_evidence_refs to luzione_api_runtime/);
  assert.doesNotMatch(postInferenceConstraintMigration, /grant (?:update|delete|truncate)[^;]*sultan_api_admission_evidence_refs/i);
  assert.match(stage5Migration, /revoke all on[\s\S]*from public, anon, authenticated, service_role, luzione_provider_worker/);
  assert.match(stage5Migration, /grant select, insert on[\s\S]*to luzione_api_runtime/);
  assert.doesNotMatch(stage5Migration, /grant (?:update|delete|truncate)[^;]*sultan_(?:stage5|canonical|api_admission|outcome)/i);
  assert.match(stage5Migration, /tenant_id = nullif\(\(select current_setting\('app\.tenant_id', true\)\), ''\)/);
});

test("Stage 5 lineage is append-only, admission-bound, content-minimized and no-effect", () => {
  assert.match(stage5Migration, /external_effects_authorized boolean not null default false check \(external_effects_authorized = false\)/);
  assert.match(stage5Migration, /sultan_agent_command_stage5_admission_fk[\s\S]*references public\.sultan_api_admission_receipts/);
  assert.match(stage5Migration, /before update or delete on public\.sultan_api_admission_receipts/);
  assert.match(stage5Migration, /raw_\?prompt\|raw_\?response\|system_\?prompt\|secret\|token\|api_\?key\|messages\|memory/);
  assert.match(stage5Migration, /sultan_stage5_outcome_readback_idx/);
  assert.match(stage5Migration, /sultan_stage5_outcome_supersedes_idx/);
  assert.match(postInferenceConstraintMigration, /sultan_stage5_admission_receipt_exact_binding/);
  assert.match(postInferenceConstraintMigration, /receipt ->> 'admissionTiming' = 'POST_INFERENCE'/);
  assert.match(postInferenceConstraintMigration, /receipt -> 'authorizesInference' = 'false'::jsonb/);
  assert.match(postInferenceConstraintMigration, /receipt ->> 'interactionReceiptHash' = interaction_receipt_hash/);
  assert.match(postInferenceConstraintMigration, /receipt -> 'credentialActor' ->> 'tenantId' = tenant_id/);
  assert.match(postInferenceConstraintMigration, /receipt -> 'participation' ->> 'contextHash' = context_hash/);
  assert.match(postInferenceConstraintMigration, /receipt -> 'evidence' ->> 'evidenceRefsHash' = evidence_refs_hash/);
  assert.match(postInferenceConstraintMigration, /receipt ->> 'receiptHash' = receipt_hash/);
  assert.match(postInferenceConstraintMigration, /receipt -> 'externalEffectsAuthorized' = 'false'::jsonb/);
  assert.match(postInferenceConstraintMigration, /sultan_stage5_outcome_receipt_exact_binding/);
  assert.match(postInferenceConstraintMigration, /receipt ->> 'observationId' = observation_id/);
  assert.match(postInferenceConstraintMigration, /receipt -> 'evidence' ->> 'readbackReceiptId' = readback_receipt_id/);
  assert.match(postInferenceConstraintMigration, /receipt -> 'observer' ->> 'tenantId' = tenant_id/);
  assert.match(postInferenceConstraintMigration, /create table public\.sultan_api_admission_evidence_refs/);
  assert.match(postInferenceConstraintMigration, /foreign key \(tenant_id, admission_receipt_id, admission_receipt_hash\)/);
  assert.match(postInferenceConstraintMigration, /foreign key \(tenant_id, readback_receipt_id, readback_hash\)/);
  assert.match(postInferenceConstraintMigration, /sultan_stage5_admission_evidence_exact_child/);
  assert.match(postInferenceConstraintMigration, /sultan_stage5_admission_evidence_complete/);
  assert.match(postInferenceConstraintMigration, /sultan_stage5_admission_evidence_parent_idx/);
  assert.match(postInferenceConstraintMigration, /receipt -> 'outcomeExpectationBinding' -> 'interactionReceiptBound' = 'true'::jsonb/);
  assert.match(postInferenceConstraintMigration, /receipt -> 'expectationBinding' -> 'interactionReceiptBound' = 'true'::jsonb/);
  assert.match(postInferenceConstraintMigration, /sultan_stage5_outcome_exact_admission_fk/);
  assert.match(postInferenceConstraintMigration, /sultan_stage5_outcome_exact_readback_fk/);
  assert.match(postInferenceConstraintMigration, /sultan_stage5_outcome_exact_admission_idx/);
  assert.match(postInferenceConstraintMigration, /sultan_stage5_outcome_exact_readback_idx/);
  assert.match(postInferenceConstraintMigration, /receipt -> 'observationRequest' ->> 'admissionReceiptId' = admission_receipt_id/);
  assert.match(postInferenceConstraintMigration, /receipt ->> 'purpose' = 'agent-case-post-inference'/);
  assert.match(postInferenceConstraintMigration, /sourceRunIdHash' = encode\(digest\(run_id, 'sha256'\), 'hex'\)/);
  assert.match(postInferenceConstraintMigration, /sultan_stage5_outcome_exact_parent_lineage/);
  assert.match(postInferenceConstraintMigration, /receipt_hash = new\.receipt #>> '\{admissionLineage,admissionReceiptHash\}'/);
  assert.match(postInferenceConstraintMigration, /readback_hash = new\.receipt #>> '\{evidence,readbackHash\}'/);
  assert.doesNotMatch(postInferenceConstraintMigration, /api_deployment_sha = new\.admission_api_deployment_sha/);
  assert.doesNotMatch(postInferenceConstraintMigration, /api_deployment_sha = new\.readback_api_deployment_sha/);
  assert.match(postInferenceConstraintMigration, /outcome claim\/value does not match exact canonical parent claim/);
  assert.match(postInferenceConstraintMigration, /\) is true\)/);
});

test("gateway policies share the init-plan-safe tenant boundary", () => {
  const initPlanSafe = /tenant_id = nullif\(\(select current_setting\('app\.tenant_id', true\)\), ''\)/;
  assert.match(policyMigration, initPlanSafe);
  assert.match(actionMigration, initPlanSafe);
  assert.match(actionMigration, /external_effect_authorized = false and provider_dispatch_authorized = false/);
});

test("disposable proof directly rejects forged and incomplete database lineage", () => {
  assert.match(disposableRehearsal, /sql-negative-readback-json/);
  assert.match(disposableRehearsal, /sql-negative-missing-evidence/);
  assert.match(disposableRehearsal, /sultan_stage5_admission_evidence_complete immediate/);
  assert.match(disposableRehearsal, /sql-negative-outcome-parent/);
  assert.match(disposableRehearsal, /sql-negative-outcome-lineage/);
  assert.match(disposableRehearsal, /sql-negative-admission-run-digest/);
  assert.match(disposableRehearsal, /expectSqlState\("23514"/);
  assert.match(disposableRehearsal, /expectSqlState\("23503"/);
  assert.match(managedRehearsal, /RECEIPT_VERIFIED_SYNTHETIC/);
  assert.match(managedRehearsal, /fixtureRolledBack',true/);
  assert.match(managedRehearsal, /stage5-managed-cross-tenant/);
  assert.match(managedRehearsal, /stage5-managed-missing-evidence/);
  assert.match(managedRehearsal, /sultan_stage5_admission_evidence_complete immediate/);
  assert.match(managedRehearsal, /externalEffectsAuthorized',false/);
  assert.match(managedRehearsal, /productionEvidence',false/);
});

test("Stage 5 routes authenticate server workloads and never report execution authority", () => {
  const routes = [
    "src/app/api/v1/sultan/admissions/route.ts",
    "src/app/api/v1/sultan/canonical-readbacks/route.ts",
    "src/app/api/v1/sultan/outcome-observations/route.ts",
  ].map((path) => readFileSync(path, "utf8"));
  for (const route of routes) {
    assert.match(route, /requireServiceActor\(request\.headers/);
    assert.match(route, /stage5Pins\(\)/);
    assert.doesNotMatch(route, /tenantId\s*:\s*(?:body|request|assertion|readback|observation)\./);
  }
  assert.match(routes[0], /admissionTiming: "POST_INFERENCE"/);
  assert.match(routes[0], /reasoningAuthorized: false/);
  assert.doesNotMatch(routes[0], /reasoningAuthorized:\s*receipt\.status/);
  assert.match(routes[0], /executionAuthorized: false/);
  assert.match(routes[2], /export async function GET/);
  assert.match(routes[2], /readVerifiedOutcome/);
  assert.match(routes[2], /receiptOriginVerified: true/);
  assert.match(routes[2], /receiptHashVerified: true/);
  assert.match(routes[2], /learningPromotionAuthorized: false/);
  assert.match(routes[2], /externalEffectsAuthorized: false/);
  const service = readFileSync("src/modules/sultan-stage5/service.ts", "utf8");
  const workload = readFileSync("src/modules/sultan-stage5/workload.ts", "utf8");
  assert.match(service, /isExactStage5ConsumerWorkload\(actor, capability\)/);
  assert.match(workload, /actor\.source === "vercel-oidc"/);
  assert.match(workload, /service:luzione-ui/);
  assert.match(workload, /service:sultan-os/);
});
