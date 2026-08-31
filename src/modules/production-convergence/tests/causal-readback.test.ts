import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CAUSAL_READBACK_CONTRACT_VERSION,
  buildCommandCausalReadback,
  buildProjectionFreshness,
  causalReadbackLaw,
  missingCausalReadback,
} from "@/modules/platform-contracts/readbackContract";

const NOW = "2026-08-31T04:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "cmd-1",
    committedAt: "2026-08-31T03:58:00.000Z",
    committedObjectVersion: "lead:v3",
    eventId: "evt-1",
    outboxMessageId: "out-1",
    receiptId: "rcpt-1",
    receiptState: "DOMAIN_COMMITTED",
    targetObjectId: "lead-1",
    targetObjectType: "lead",
    targetOwnerProject: "LUZIONE_P008",
    tenantId: "tenant-a",
    ...overrides,
  };
}

test("causal readback law rejects HTTP/provider shortcuts to business finality", () => {
  assert.equal(causalReadbackLaw.httpSuccessIsBusinessCompletion, false);
  assert.equal(causalReadbackLaw.providerAcknowledgementIsBusinessFinality, false);
  assert.equal(causalReadbackLaw.sourceConfirmationRequiresReadback, true);
});

test("domain commit and provider acknowledgement remain non-final", () => {
  const committed = buildCommandCausalReadback({ now: NOW, row: row() });
  assert.equal(committed.finality, "DOMAIN_COMMITTED");
  assert.equal(committed.businessFinal, false);

  const acknowledged = buildCommandCausalReadback({
    now: NOW,
    row: row({
      providerAcknowledgedAt: "2026-08-31T03:59:00.000Z",
      providerAcknowledgementRef: "provider:ack-1",
      receiptState: "PROVIDER_ACKNOWLEDGED",
    }),
  });
  assert.equal(acknowledged.finality, "PROVIDER_ACKNOWLEDGED");
  assert.equal(acknowledged.businessFinal, false);
  assert.match(acknowledged.reason, /not confirmed business completion/i);
});

test("reconciliation evidence is explicit and non-final", () => {
  const readback = buildCommandCausalReadback({
    now: NOW,
    row: row({
      checkedAt: "2026-08-31T03:59:30.000Z",
      receiptState: "RECONCILIATION_REQUIRED",
      reconciliationId: "rec-1",
      reconciliationResult: "AMBIGUOUS",
    }),
  });
  assert.equal(readback.finality, "RECONCILING");
  assert.equal(readback.evidence.reconciliationId, "rec-1");
  assert.equal(readback.businessFinal, false);
});

test("fresh source confirmation alone supports bounded business finality", () => {
  const readback = buildCommandCausalReadback({
    freshnessPolicyMs: 300_000,
    now: NOW,
    row: row({
      receiptState: "SOURCE_CONFIRMED",
      sourceConfirmedAt: "2026-08-31T03:59:00.000Z",
      sourceReadbackRef: "shopify:order:1:v3",
    }),
  });
  assert.equal(readback.contractVersion, CAUSAL_READBACK_CONTRACT_VERSION);
  assert.equal(readback.finality, "SOURCE_CONFIRMED");
  assert.equal(readback.freshness.state, "FRESH");
  assert.equal(readback.businessFinal, true);
});

test("stale source evidence remains historical but requires reconciliation", () => {
  const readback = buildCommandCausalReadback({
    freshnessPolicyMs: 300_000,
    now: NOW,
    row: row({
      receiptState: "SOURCE_CONFIRMED",
      sourceConfirmedAt: "2026-08-31T03:00:00.000Z",
      sourceReadbackRef: "shopify:order:1:v2",
    }),
  });
  assert.equal(readback.finality, "RECONCILING");
  assert.equal(readback.freshness.state, "STALE");
  assert.equal(readback.businessFinal, false);
});

test("missing evidence reveals no object identity", () => {
  const readback = missingCausalReadback({ receiptId: "unknown", tenantId: "tenant-a" });
  assert.equal(readback.finality, "MISSING");
  assert.equal(readback.object.id, null);
  assert.equal(readback.evidence.receiptId, "unknown");
});

test("projection freshness publishes source and source version", () => {
  const readback = buildProjectionFreshness({
    freshnessPolicyMs: 900_000,
    now: NOW,
    observedAt: "2026-08-31T03:50:00.000Z",
    owner: "CIBOTFLOW/Luzione-API:P113",
    source: "shopify",
    sourceVersion: "p113run-1",
  });
  assert.equal(readback.freshness.state, "FRESH");
  assert.equal(readback.source, "shopify");
  assert.equal(readback.sourceVersion, "p113run-1");
});

test("HTTP and Postgres read boundaries are authenticated, validated and tenant-bound", () => {
  const service = readFileSync("src/lib/platform-guarantees/readService.ts", "utf8");
  const route = readFileSync("src/app/api/v1/platform-guarantees/route.ts", "utf8");
  const catalog = readFileSync("src/modules/catalog-projection/store.ts", "utf8");
  assert.match(route, /requireServiceActor\(request\.headers, "platform\.guarantees\.read"\)/);
  assert.match(route, /searchParams\.get\("receiptId"\)/);
  assert.match(route, /\^\[A-Za-z0-9\._:-\]\{3,200\}\$/);
  assert.match(service, /where r\.tenant_id = \$1 and r\.receipt_id = \$2/);
  assert.match(service, /begin read only/i);
  assert.match(service, /p110_reconciliation_checkpoints/);
  assert.match(service, /p110_delivery_attempts/);
  assert.doesNotMatch(route, /tenantId\s*:\s*url\.searchParams/);
  assert.match(catalog, /readback:\s*buildProjectionFreshness/);
});
