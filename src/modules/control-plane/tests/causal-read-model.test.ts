import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const readModel = fs.readFileSync(path.join(process.cwd(), "src/lib/control-plane/causalReadModel.ts"), "utf8");
const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/v1/commands/[commandId]/causal/route.ts"), "utf8");

test("causal receipt retrieval is tenant-scoped across every evidence table", () => {
  assert.match(readModel, /canonical_tenant_id = \$1 and command_id = \$2/);
  assert.match(readModel, /platform_execution_steps[\s\S]*tenant_id = \$1 and command_id = \$2/);
  assert.match(readModel, /platform_audit_events[\s\S]*tenant_id = \$1 and command_id = \$2/);
  assert.match(readModel, /platform_effect_receipts[\s\S]*tenant_id = \$1 and command_id = \$2/);
  assert.match(route, /requireCanonicalActor/);
  assert.match(route, /Luzione_CAUSAL_RECEIPT_V1|LUZIONE_CAUSAL_RECEIPT_V1/);
});

test("causal read model distinguishes provider acknowledgement from source readback", () => {
  assert.match(readModel, /providerAcknowledged/);
  assert.match(readModel, /sourceReadbackConfirmed/);
  assert.match(readModel, /businessOutcomeConfirmed: sourceReadbackConfirmed/);
  assert.match(readModel, /businessSuccessRequiresSourceReadback: true/);
  assert.doesNotMatch(readModel, /businessOutcomeConfirmed:\s*providerAcknowledged/);
});

test("causal read model exposes references and state but not raw provider or audit payload bodies", () => {
  assert.match(readModel, /rawProviderPayloadIncluded: false/);
  assert.match(readModel, /rawProviderReadbackIncluded: false/);
  assert.match(readModel, /rawAuditEvidenceIncluded: false/);
  assert.doesNotMatch(readModel, /select[^`]*provider_readback/i);
  assert.doesNotMatch(readModel, /select[^`]*normalized_outcome/i);
  assert.doesNotMatch(readModel, /select[^`]*evidence\b/i);
});

test("causal retrieval is a read-only adapter over the existing durable owners", () => {
  assert.match(readModel, /begin read only/);
  assert.match(readModel, /from public\.p110_command_receipts/);
  assert.match(readModel, /from public\.platform_execution_steps/);
  assert.match(readModel, /from public\.platform_audit_events/);
  assert.match(readModel, /from public\.platform_effect_receipts/);
  assert.doesNotMatch(readModel, /\binsert\s+into\b/i);
  assert.doesNotMatch(readModel, /\bupdate\s+public\./i);
  assert.doesNotMatch(readModel, /\bdelete\s+from\b/i);
});
