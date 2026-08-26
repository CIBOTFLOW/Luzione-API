import "server-only";

import type { PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import {
  buildP113Completion,
  hashP113Payload,
  p113SyncRunId,
  P113_PROJECTION_CONTRACT_VERSION,
  P113_SOURCE_OF_TRUTH,
  type P113Completion,
  type P113IngestCommand,
  type P113MappingEvidence,
} from "@/modules/catalog-projection/runtime";

const P113_POLICY_VERSION = "2026-08-26.p113.api-runtime.v1";

export type P113IngestReceipt = {
  blockedVariantCount: number;
  coveragePercent: number;
  eligibleVariantCount: number;
  exactSourceCountMatch: boolean;
  externalWriteAuthorized: false;
  productsObserved: number;
  projectionCount: number;
  replayed: boolean;
  state: "CURRENT" | "RECONCILIATION_REQUIRED";
  syncRunId: string;
  variantsObserved: number;
};

export class P113IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used for a different catalog payload.");
    this.name = "P113IdempotencyConflictError";
  }
}

async function beginTenantTransaction(client: PoolClient, tenantId: string, readOnly = false) {
  await client.query(readOnly ? "begin read only" : "begin");
  await client.query("set local statement_timeout = '12s'");
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
}

async function rollbackQuietly(client: PoolClient) {
  await client.query("rollback").catch(() => undefined);
}

function receiptFromCompletion(
  syncRunId: string,
  completion: P113Completion,
  replayed: boolean,
): P113IngestReceipt {
  return {
    blockedVariantCount: completion.blockedVariantCount,
    coveragePercent: completion.coveragePercent,
    eligibleVariantCount: completion.eligibleVariantCount,
    exactSourceCountMatch: completion.exactSourceCountMatch,
    externalWriteAuthorized: false,
    productsObserved: completion.productsObserved,
    projectionCount: completion.projections.length,
    replayed,
    state: completion.state,
    syncRunId,
    variantsObserved: completion.variantsObserved,
  };
}

function receiptFromStoredRow(row: Record<string, unknown>): P113IngestReceipt {
  const payload = row.payload && typeof row.payload === "object"
    ? row.payload as Record<string, unknown>
    : {};
  const state = row.state === "CURRENT" ? "CURRENT" : "RECONCILIATION_REQUIRED";
  return {
    blockedVariantCount: Number(payload.blockedVariantCount ?? 0),
    coveragePercent: Number(row.coverage_percent ?? 0),
    eligibleVariantCount: Number(payload.eligibleVariantCount ?? 0),
    exactSourceCountMatch: payload.exactSourceCountMatch === true,
    externalWriteAuthorized: false,
    productsObserved: Number(row.products_observed ?? 0),
    projectionCount: Number(payload.projectionCount ?? 0),
    replayed: true,
    state,
    syncRunId: String(row.sync_run_id),
    variantsObserved: Number(row.variants_observed ?? 0),
  };
}

async function readP107Mappings(client: PoolClient, tenantId: string) {
  const result = await client.query(
    `
      select mapping_id, source_version_id, product_ref, sku,
             shopify_product_gid, shopify_variant_gid, shopify_handle,
             manufacturer_normalized, manufacturer_raw, mapping_state,
             freshness
        from public.p107_product_manufacturer_mappings
       where tenant_id = $1
         and mapping_state <> 'superseded'
       order by recorded_at desc
    `,
    [tenantId],
  );
  const evidence: P113MappingEvidence[] = [];
  const seen = new Set<string>();
  for (const row of result.rows) {
    const refs = [
      row.product_ref,
      row.sku,
      row.shopify_product_gid,
      row.shopify_variant_gid,
      row.shopify_handle,
    ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
    for (const productRef of refs) {
      if (seen.has(productRef)) continue;
      seen.add(productRef);
      evidence.push({
        freshness: typeof row.freshness === "string" ? row.freshness : null,
        manufacturerNormalized: typeof row.manufacturer_normalized === "string"
          ? row.manufacturer_normalized
          : null,
        manufacturerRaw: typeof row.manufacturer_raw === "string" ? row.manufacturer_raw : null,
        mappingId: typeof row.mapping_id === "string" ? row.mapping_id : null,
        mappingState: typeof row.mapping_state === "string" ? row.mapping_state : null,
        productRef,
        sourceVersionId: typeof row.source_version_id === "string" ? row.source_version_id : null,
      });
    }
  }
  return evidence;
}

export async function ingestP113CatalogProjection(input: {
  actor: ApiActor;
  command: P113IngestCommand;
  idempotencyKey: string;
}): Promise<P113IngestReceipt> {
  const client = await databasePool().connect();
  const syncRunId = p113SyncRunId(input.actor.tenantId, input.idempotencyKey);
  const commandHash = hashP113Payload(input.command);
  const idempotencyKeyHash = hashP113Payload({
    idempotencyKey: input.idempotencyKey,
    tenantId: input.actor.tenantId,
  });
  const observedAt = new Date().toISOString();

  try {
    await beginTenantTransaction(client, input.actor.tenantId);
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`p113:catalog-sync:${input.actor.tenantId}`],
    );
    const existing = await client.query(
      `
        select sync_run_id, state, products_observed, variants_observed,
               coverage_percent, payload
          from public.p113_catalog_sync_runs
         where tenant_id = $1 and sync_run_id = $2
         for update
      `,
      [input.actor.tenantId, syncRunId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      const row = existing.rows[0] as Record<string, unknown>;
      const payload = row.payload && typeof row.payload === "object"
        ? row.payload as Record<string, unknown>
        : {};
      if (payload.commandHash !== commandHash) throw new P113IdempotencyConflictError();
      if (row.state === "BACKFILLING" || row.state === "FAILED") {
        throw new P113IdempotencyConflictError();
      }
      await client.query("commit");
      return receiptFromStoredRow(row);
    }

    const commandPayload = {
      commandHash,
      contractVersion: input.command.contractVersion,
      cursorCount: input.command.cursors.length,
      externalWriteAuthorized: false,
      idempotencyKeyHash,
      productCount: input.command.products.length,
      sourceOwner: "shopify",
    };
    await client.query(
      `
        insert into public.p113_catalog_sync_runs (
          tenant_id, sync_run_id, state, source_owner, started_at,
          external_write_authorized, payload_hash, payload, actor_id,
          actor_type, policy_version
        ) values ($1,$2,'BACKFILLING','shopify',$3,false,$4,$5::jsonb,$6,$7,$8)
      `,
      [
        input.actor.tenantId,
        syncRunId,
        observedAt,
        hashP113Payload(commandPayload),
        JSON.stringify(commandPayload),
        input.actor.actorId,
        input.actor.actorType,
        P113_POLICY_VERSION,
      ],
    );

    for (const observation of input.command.cursors) {
      const cursorId = `p113cur_${hashP113Payload({
        kind: observation.kind,
        ownerRef: observation.ownerRef,
        pageOrdinal: observation.pageOrdinal,
        syncRunId,
      }).slice(0, 24)}`;
      await client.query(
        `
          insert into public.p113_catalog_sync_cursors (
            tenant_id, cursor_id, sync_run_id, cursor_kind, owner_ref,
            cursor_value, page_ordinal, observed_count, has_next_page,
            recorded_at, payload_hash
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          on conflict (tenant_id, cursor_id) do nothing
        `,
        [
          input.actor.tenantId,
          cursorId,
          syncRunId,
          observation.kind,
          observation.ownerRef,
          observation.cursorValue,
          observation.pageOrdinal,
          observation.observedCount,
          observation.hasNextPage,
          observedAt,
          hashP113Payload(observation),
        ],
      );
    }

    const mappings = await readP107Mappings(client, input.actor.tenantId);
    const completion = buildP113Completion(input.command, mappings, observedAt);
    const projectionRows = completion.projections.map((projection) => ({
      blocked_reasons: projection.blockedReasons,
      last_synced_at: projection.lastSyncedAt,
      p107_mapping_ref: projection.p107MappingRef,
      payload: projection.payload,
      payload_hash: projection.payloadHash,
      projection_id: projection.projectionId,
      quote_selectable: projection.quoteSelectable,
      search_text: projection.searchText,
      shopify_product_gid: projection.shopifyProductId,
      shopify_variant_gid: projection.shopifyVariantId,
      source_updated_at: projection.sourceUpdatedAt,
      source_version: projection.sourceVersion,
      status: projection.status,
    }));

    await client.query(
      `
        update public.p113_catalog_search_projections
           set status = 'STALE', quote_selectable = false,
               blocked_reasons = case
                 when blocked_reasons @> array['not_observed_in_latest_sync']::text[] then blocked_reasons
                 else blocked_reasons || 'not_observed_in_latest_sync'::text
               end
         where tenant_id = $1
      `,
      [input.actor.tenantId],
    );
    if (projectionRows.length > 0) {
      await client.query(
        `
          insert into public.p113_catalog_search_projections (
            tenant_id, projection_id, shopify_product_gid, shopify_variant_gid,
            p107_mapping_ref, source_version, search_text, status,
            quote_selectable, blocked_reasons, source_updated_at,
            last_synced_at, payload_hash, payload
          )
          select $1, row.projection_id, row.shopify_product_gid,
                 row.shopify_variant_gid, row.p107_mapping_ref,
                 row.source_version, row.search_text, row.status,
                 row.quote_selectable, row.blocked_reasons,
                 row.source_updated_at, row.last_synced_at,
                 row.payload_hash, row.payload
            from jsonb_to_recordset($2::jsonb) as row(
              projection_id text, shopify_product_gid text,
              shopify_variant_gid text, p107_mapping_ref text,
              source_version text, search_text text, status text,
              quote_selectable boolean, blocked_reasons text[],
              source_updated_at timestamptz, last_synced_at timestamptz,
              payload_hash text, payload jsonb
            )
          on conflict (tenant_id, projection_id) do update set
            shopify_product_gid = excluded.shopify_product_gid,
            shopify_variant_gid = excluded.shopify_variant_gid,
            p107_mapping_ref = excluded.p107_mapping_ref,
            source_version = excluded.source_version,
            search_text = excluded.search_text,
            status = excluded.status,
            quote_selectable = excluded.quote_selectable,
            blocked_reasons = excluded.blocked_reasons,
            source_updated_at = excluded.source_updated_at,
            last_synced_at = excluded.last_synced_at,
            payload_hash = excluded.payload_hash,
            payload = excluded.payload
        `,
        [input.actor.tenantId, JSON.stringify(projectionRows)],
      );
    }

    const summary = {
      blockedVariantCount: completion.blockedVariantCount,
      commandHash,
      contractVersion: input.command.contractVersion,
      coveragePercent: completion.coveragePercent,
      eligibleVariantCount: completion.eligibleVariantCount,
      exactSourceCountMatch: completion.exactSourceCountMatch,
      externalWriteAuthorized: false,
      idempotencyKeyHash,
      productsObserved: completion.productsObserved,
      projectionCount: completion.projections.length,
      sourceCounts: input.command.sourceCounts,
      state: completion.state,
      variantsObserved: completion.variantsObserved,
    };
    const observationId = `p113cov_${hashP113Payload({ summary, syncRunId }).slice(0, 24)}`;
    await client.query(
      `
        insert into public.p113_catalog_coverage_observations (
          tenant_id, observation_id, sync_run_id, independent_oracle_ref,
          products_observed, variants_observed, eligible_variants,
          blocked_variants, hard_page_limit_detected, observed_at,
          payload_hash, payload
        ) values ($1,$2,$3,'shopify.productsCount+productVariantsCount',$4,$5,$6,$7,false,$8,$9,$10::jsonb)
        on conflict (tenant_id, observation_id) do nothing
      `,
      [
        input.actor.tenantId,
        observationId,
        syncRunId,
        completion.productsObserved,
        completion.variantsObserved,
        completion.eligibleVariantCount,
        completion.blockedVariantCount,
        observedAt,
        hashP113Payload(summary),
        JSON.stringify(summary),
      ],
    );

    if (completion.state === "CURRENT") {
      await client.query(
        `
          update public.p113_catalog_reconciliation_items
             set state = 'resolved'
           where tenant_id = $1 and item_type = 'cursor_gap'
             and source_ref = 'shopify.productsCount+productVariantsCount'
             and state = 'open'
        `,
        [input.actor.tenantId],
      );
    } else {
      const reconciliationPayload = {
        commandHash,
        observed: {
          products: completion.productsObserved,
          variants: completion.variantsObserved,
        },
        sourceCounts: input.command.sourceCounts,
      };
      await client.query(
        `
          insert into public.p113_catalog_reconciliation_items (
            tenant_id, reconciliation_item_id, sync_run_id, item_type,
            source_ref, state, severity, resolution_action,
            payload_hash, payload
          ) values ($1,$2,$3,'cursor_gap',
            'shopify.productsCount+productVariantsCount','open','blocked',
            'Re-run the full cursor walk and investigate source count precision or missing product/variant pages.',
            $4,$5::jsonb)
          on conflict (tenant_id, reconciliation_item_id) do nothing
        `,
        [
          input.actor.tenantId,
          `p113rec_${hashP113Payload({ reconciliationPayload, syncRunId }).slice(0, 24)}`,
          syncRunId,
          hashP113Payload(reconciliationPayload),
          JSON.stringify(reconciliationPayload),
        ],
      );
    }

    const completed = await client.query(
      `
        update public.p113_catalog_sync_runs
           set state = $3, completed_at = $4,
               products_observed = $5, variants_observed = $6,
               coverage_percent = $7, payload_hash = $8, payload = $9::jsonb
         where tenant_id = $1 and sync_run_id = $2 and state = 'BACKFILLING'
         returning state, products_observed, variants_observed,
                   coverage_percent, external_write_authorized, payload_hash
      `,
      [
        input.actor.tenantId,
        syncRunId,
        completion.state,
        observedAt,
        completion.productsObserved,
        completion.variantsObserved,
        completion.coveragePercent,
        hashP113Payload(summary),
        JSON.stringify(summary),
      ],
    );
    const readback = completed.rows[0];
    if (
      (completed.rowCount ?? 0) !== 1
      || readback.external_write_authorized !== false
      || readback.payload_hash !== hashP113Payload(summary)
      || readback.state !== completion.state
    ) {
      throw new Error("P113 catalog completion readback failed.");
    }
    await client.query("commit");
    return receiptFromCompletion(syncRunId, completion, false);
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

function encodeCursor(projectionId: string) {
  return Buffer.from(JSON.stringify({ projectionId }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return typeof parsed.projectionId === "string" ? parsed.projectionId : null;
  } catch {
    return null;
  }
}

export async function listP113CatalogProjections(input: {
  actor: ApiActor;
  cursor: string | null;
  limit: number;
  productType: string | null;
  query: string | null;
  quoteSelectable: boolean | null;
  status: string | null;
  vendor: string | null;
}) {
  const client = await databasePool().connect();
  const after = decodeCursor(input.cursor);
  if (input.cursor && !after) throw new Error("P113_CURSOR_INVALID");
  try {
    await beginTenantTransaction(client, input.actor.tenantId, true);
    const filters = ["tenant_id = $1", "status <> 'STALE'"];
    const values: unknown[] = [input.actor.tenantId];
    if (after) {
      values.push(after);
      filters.push(`projection_id > $${values.length}`);
    }
    if (input.query) {
      values.push(`%${input.query}%`);
      filters.push(`search_text ilike $${values.length}`);
    }
    if (input.vendor) {
      values.push(input.vendor);
      filters.push(`payload->>'vendor' = $${values.length}`);
    }
    if (input.productType) {
      values.push(input.productType);
      filters.push(`payload->>'productType' = $${values.length}`);
    }
    if (input.status) {
      values.push(input.status);
      filters.push(`payload->>'status' = $${values.length}`);
    }
    if (input.quoteSelectable !== null) {
      values.push(input.quoteSelectable);
      filters.push(`quote_selectable = $${values.length}`);
    }
    values.push(input.limit + 1);
    const result = await client.query(
      `
        select projection_id, payload, quote_selectable, blocked_reasons,
               source_version, last_synced_at
          from public.p113_catalog_search_projections
         where ${filters.join(" and ")}
         order by projection_id
         limit $${values.length}
      `,
      values,
    );
    const page = result.rows.slice(0, input.limit);
    const latestRun = await client.query(
      `
        select sync_run_id, state, completed_at, products_observed,
               variants_observed, coverage_percent, payload
          from public.p113_catalog_sync_runs
         where tenant_id = $1 and state in ('CURRENT','RECONCILIATION_REQUIRED')
         order by completed_at desc nulls last
         limit 1
      `,
      [input.actor.tenantId],
    );
    await client.query("commit");
    const latest = latestRun.rows[0] ?? null;
    const latestPayload = latest?.payload && typeof latest.payload === "object"
      ? latest.payload as Record<string, unknown>
      : {};
    const totalVariantCount = Number(latest?.variants_observed ?? 0);
    return {
      contractVersion: P113_PROJECTION_CONTRACT_VERSION,
      coverage: {
        blockedVariantCount: Number(latestPayload.blockedVariantCount ?? 0),
        eligibleVariantCount: Number(latestPayload.eligibleVariantCount ?? 0),
        formerCeilingRetired: totalVariantCount > 200,
        hasHardPageLimit: false,
        independentOracle: "Shopify productsCount + productVariantsCount with complete cursor receipts and P107 mapping evidence.",
        productsObserved: Number(latest?.products_observed ?? 0),
        totalVariantCount,
      },
      cursor: {
        limit: input.limit,
        nextCursor: result.rows.length > input.limit
          ? encodeCursor(String(page[page.length - 1].projection_id))
          : null,
      },
      filters: {
        productType: input.productType,
        query: input.query,
        status: input.status,
        vendor: input.vendor,
      },
      latestRun: latest,
      selections: page.map((row) => row.payload),
      sourceOfTruth: P113_SOURCE_OF_TRUTH,
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}
