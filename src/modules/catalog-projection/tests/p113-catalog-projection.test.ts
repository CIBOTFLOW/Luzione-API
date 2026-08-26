import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  P113ContractError,
  P113_INGEST_CONTRACT_VERSION,
  buildP113Completion,
  hashP113Payload,
  p113SyncRunId,
  parseP113IngestCommand,
} from "../runtime";

function command() {
  return parseP113IngestCommand({
    contractVersion: P113_INGEST_CONTRACT_VERSION,
    cursors: [{
      cursorValue: null,
      hasNextPage: false,
      kind: "product_connection",
      observedCount: 1,
      ownerRef: "shopify.products",
      pageOrdinal: 0,
    }],
    products: [{
      handle: "chair",
      id: "local-product",
      productType: "Chair",
      shopifyProductId: "gid://shopify/Product/1",
      sourceUpdatedAt: "2026-08-26T18:00:00.000Z",
      status: "ACTIVE",
      tags: ["seating"],
      title: "Luzione Chair",
      variants: [{
        id: "gid://shopify/ProductVariant/11",
        inventoryQuantity: 4,
        price: "250.00",
        sku: "CHAIR-1",
        title: "Natural",
      }],
      vendor: "Luzione",
    }],
    sourceCounts: {
      productCount: 1,
      productCountPrecision: "EXACT",
      variantCount: 1,
      variantCountPrecision: "EXACT",
    },
  });
}

test("builds a current, quote-selectable P113 projection only with accepted current mapping evidence", () => {
  const result = buildP113Completion(command(), [{
    freshness: "current",
    manufacturerNormalized: "Luzione",
    manufacturerRaw: "Luzione",
    mappingId: "p107-map-1",
    mappingState: "accepted",
    productRef: "CHAIR-1",
    sourceVersionId: "p107-version-1",
  }], "2026-08-26T20:00:00.000Z");
  assert.equal(result.state, "CURRENT");
  assert.equal(result.coveragePercent, 100);
  assert.equal(result.eligibleVariantCount, 1);
  assert.equal(result.blockedVariantCount, 0);
  assert.equal(result.projections[0].quoteSelectable, true);
  assert.equal(result.projections[0].payload.ownerRefs.p107Mapping, "p107-map-1");
});

test("keeps exact coverage distinct from quote eligibility", () => {
  const result = buildP113Completion(command(), [], "2026-08-26T20:00:00.000Z");
  assert.equal(result.state, "CURRENT");
  assert.equal(result.exactSourceCountMatch, true);
  assert.equal(result.eligibleVariantCount, 0);
  assert.deepEqual(result.projections[0].blockedReasons, ["p107_mapping_missing"]);
});

test("requires exact independent counts before declaring the projection current", () => {
  const value = command();
  value.sourceCounts.productCount = 2;
  const result = buildP113Completion(value, [], "2026-08-26T20:00:00.000Z");
  assert.equal(result.state, "RECONCILIATION_REQUIRED");
  assert.equal(result.exactSourceCountMatch, false);
  assert.equal(result.coveragePercent, 50);
  assert.equal(result.eligibleVariantCount, 0);
  assert.equal(result.projections[0].quoteSelectable, false);
  assert.ok(result.projections[0].blockedReasons.includes("catalog_coverage_not_current"));
});

test("rejects authority smuggling and unsupported contracts", () => {
  assert.throws(
    () => parseP113IngestCommand({ ...command(), tenantId: "forged" }),
    (error: unknown) => error instanceof P113ContractError && error.code === "P113_AUTHORITY_FORGED",
  );
  assert.throws(
    () => parseP113IngestCommand({ ...command(), contractVersion: "future" }),
    (error: unknown) => error instanceof P113ContractError && error.code === "P113_UNSUPPORTED_VERSION",
  );
});

test("hashes payloads and idempotent run identity deterministically", () => {
  assert.equal(hashP113Payload({ b: 2, a: 1 }), hashP113Payload({ a: 1, b: 2 }));
  assert.equal(p113SyncRunId("tenant", "key-12345"), p113SyncRunId("tenant", "key-12345"));
  assert.notEqual(p113SyncRunId("tenant", "key-12345"), p113SyncRunId("other", "key-12345"));
});

test("the service boundary is authenticated, idempotent, and never authorizes external writes", () => {
  const route = readFileSync("src/app/api/v1/catalog/shopify/projections/route.ts", "utf8");
  const store = readFileSync("src/modules/catalog-projection/store.ts", "utf8");
  assert.match(route, /requireServiceActor\(request\.headers\)/);
  assert.match(route, /Idempotency-Key header is required/);
  assert.match(route, /internalProjectionsEnabled/);
  assert.match(store, /pg_advisory_xact_lock/);
  assert.match(store, /external_write_authorized[^\n]+false/);
  assert.match(store, /returning state, products_observed/);
  assert.doesNotMatch(route, /SHOPIFY_(ADMIN|ACCESS)_TOKEN|DATABASE_URL/);
});
