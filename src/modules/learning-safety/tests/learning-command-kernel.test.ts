import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { learningCommandContentDigest } from "@/lib/learning-safety/contract";

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260829050000_learning_command_kernel_adapter.sql",
  ),
  "utf8",
);
const activePolicyMigration = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260829051000_learning_active_policy_time_of_use.sql",
  ),
  "utf8",
);
const immutableCommandMigration = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260829053000_learning_command_receipt_immutability.sql",
  ),
  "utf8",
);
const guardianIndexMigration = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260829054000_learning_guardian_fk_indexes.sql",
  ),
  "utf8",
);
const adapter = fs.readFileSync(
  path.join(process.cwd(), "src/lib/learning-safety/commandKernel.ts"),
  "utf8",
);
const route = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/app/api/v1/commands/[commandId]/learning-transition/route.ts",
  ),
  "utf8",
);
const validationProbes = fs.readFileSync(
  path.join(
    process.cwd(),
    "scripts/validation/learning-command-kernel-probes.sql",
  ),
  "utf8",
);

test("learning command digests bind exact tenant, candidate, evaluation, and transition", () => {
  const base = {
    candidateVersionId: "10000000-0000-4000-8000-000000000001",
    commandType: "learning.candidate.promote" as const,
    evaluationReceiptId: "learning_evaluation_aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedStage: "CANARY" as const,
    targetStage: "DEPLOYED" as const,
    targetVersion: "7",
    tenantId: "20000000-0000-4000-8000-000000000002",
  };
  const digest = learningCommandContentDigest(base);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, learningCommandContentDigest(base));
  assert.notEqual(
    digest,
    learningCommandContentDigest({ ...base, targetVersion: "8" }),
  );
  assert.notEqual(
    digest,
    learningCommandContentDigest({
      ...base,
      tenantId: "30000000-0000-4000-8000-000000000003",
    }),
  );
});

test("the adapter is internal-only and delegates one atomic database transition", () => {
  assert.match(adapter, /import "server-only"/);
  assert.match(adapter, /\^cmd:\[0-9a-f\]\{8\}/);
  assert.match(adapter, /apply_learning_command\(\$1::uuid, \$2::text, \$3::text\)/);
  assert.match(adapter, /actor\.principal\.identityId/);
  assert.doesNotMatch(adapter, /fetch\(|NextResponse|export async function (GET|POST)/);
});

test("the execution route accepts no learning payload and requires an explicit membership capability", () => {
  assert.match(route, /requireMembershipCapability/);
  assert.match(route, /"learning\.commands\.execute"/);
  assert.match(route, /applyLearningCommand\(actor, commandId\)/);
  assert.match(route, /externalEffectsAuthorized: false/);
  assert.doesNotMatch(route, /request\.(json|text)\(|readBoundedJson|parseCommand/);
});

test("the database gate rechecks policy, capability, kill switches, and command digest", () => {
  assert.match(migration, /state IS DISTINCT FROM 'VALIDATED'/);
  assert.match(migration, /authority_contract_version IS DISTINCT FROM 'luzione-authority\/v2'/);
  assert.match(migration, /authority_class IS DISTINCT FROM 'A2'/);
  assert.match(migration, /FROM public\.policy_evaluations/);
  assert.match(migration, /FROM public\.p110_kill_switches/);
  assert.match(migration, /FROM public\.integration_capability_registry/);
  assert.match(migration, /learning_command_content_digest/);
  assert.match(migration, /command content digest does not bind the exact transition/i);
  assert.match(migration, /policy\.actor_ref = command_row\.actor_id/);
  assert.match(migration, /policy\.resource_scope = command_row\.resource_scope/);
  assert.match(migration, /policy\.payload_hash = expected_digest/);
  assert.match(migration, /command_row\.requested_at - interval '5 minutes'/);
  assert.doesNotMatch(migration, /candidate_version_id = candidate_version_id/);
  assert.doesNotMatch(migration, /receipt_id = evaluation_receipt_id/);
  assert.match(activePolicyMigration, /definition\.status = 'ACTIVE'/);
  assert.match(activePolicyMigration, /definition\.tenant_id = NEW\.canonical_tenant_id/);
  assert.match(activePolicyMigration, /FOR KEY SHARE OF policy, definition/);
  assert.match(activePolicyMigration, /learning_policy_evaluations_immutable/);
});

test("promotion reads canonical guardians and rollback stays exact-target", () => {
  assert.match(migration, /CREATE TABLE public\.learning_guardian_decisions/);
  assert.match(migration, /JOIN public\.platform_identities/);
  assert.match(migration, /JOIN public\.tenant_memberships/);
  assert.match(migration, /configured_guardian_count IS DISTINCT FROM 3/);
  assert.match(migration, /approved_guardian_count NOT BETWEEN 2 AND 3/);
  assert.match(migration, /evaluation\.rollback_target_version IS DISTINCT FROM candidate\.last_known_good_version/);
  assert.match(migration, /candidate\.last_known_good_version IS NULL/);
  assert.match(migration, /membership\.capabilities @> '\["learning\.commands\.execute"\]'/);
  assert.match(migration, /command_row\.actor_id IS DISTINCT FROM p_actor_identity_id/);
});

test("one transaction writes one immutable receipt, exact readback, and no outbox", () => {
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /INSERT INTO public\.learning_promotion_receipts/);
  assert.match(migration, /INSERT INTO public\.learning_rollback_receipts/);
  assert.match(migration, /UPDATE public\.learning_candidate_versions/);
  assert.match(migration, /committed_stage IS DISTINCT FROM target_stage/);
  assert.match(migration, /UPDATE public\.p110_command_receipts/);
  assert.match(migration, /state = 'SOURCE_CONFIRMED'/);
  assert.match(migration, /'externalEffectsAuthorized', false/);
  assert.doesNotMatch(migration, /INSERT INTO public\.p110_outbox_messages/i);
  assert.doesNotMatch(migration, /http|webhook|provider_request/i);
  assert.match(immutableCommandMigration, /learning_command_receipt_immutable/);
  assert.match(immutableCommandMigration, /OLD\.state IS DISTINCT FROM 'VALIDATED'/);
  assert.match(immutableCommandMigration, /NEW\.state IS DISTINCT FROM 'SOURCE_CONFIRMED'/);
  assert.match(immutableCommandMigration, /v_receipt_count IS DISTINCT FROM 1/);
  assert.match(immutableCommandMigration, /learningCommandReadback/);
});

test("browser roles cannot create guardian decisions or execute learning commands", () => {
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.learning_guardian_decisions\s+FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.apply_learning_command\(uuid, text, text\)\s+FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.apply_learning_command\(uuid, text, text\) TO service_role/,
  );
  assert.match(guardianIndexMigration, /learning_guardian_decisions_identity_idx/);
  assert.match(
    guardianIndexMigration,
    /tenant_id,\s+evaluation_receipt_id,\s+candidate_version_id/,
  );
});

test("the restored-clone probe pack rolls fixtures back and covers the release matrix", () => {
  const scenarios = [
    "promotion_and_exact_replay",
    "action_change_without_guardians_blocked",
    "simultaneous_two_of_three_guardian_quorum",
    "competing_commands_commit_exactly_one_receipt",
    "idempotency_collision_blocked_before_effect",
    "stale_expected_stage_blocked",
    "wrong_tenant_blocked",
    "wrong_actor_blocked",
    "wrong_candidate_scope_blocked",
    "expired_policy_receipt_blocked",
    "archived_policy_at_commit_blocked_atomically",
    "active_capability_kill_switch_blocked",
    "command_and_policy_evidence_immutable",
    "exact_last_known_good_rollback_and_replay",
    "wrong_rollback_target_blocked",
  ];
  for (const scenario of scenarios) assert.match(validationProbes, new RegExp(scenario));
  assert.match(validationProbes, /Rollback validation fixture/g);
  assert.match(validationProbes, /CREATE TEMPORARY TABLE learning_command_probe_results/);
  assert.doesNotMatch(validationProbes, /INSERT INTO public\.p110_outbox_messages/i);
  assert.doesNotMatch(validationProbes, /\bCOMMIT\b/i);
});
