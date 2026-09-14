import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { archiveInternalActionTx } from "../internalActionArchive";
import { sha256 } from "@/modules/platform-guarantees/eventContract";

const payload = { title: "Internal draft" };
const base = { tenant_id: "luzione", receipt_id: "receipt-original", case_id: "case-1", case_type: "COMMERCIAL", campaign_id: "sultan-campaign-test", tool_id: "luzione.gmail_draft.create", object_version: "case-v1", payload, state: "SOURCE_CONFIRMED" };
const reservation = { expected_version: "commercial-case:case-1:v1", case_id: "case-1", case_type: "COMMERCIAL", preview: { payload: { campaignId: base.campaign_id, targetReceiptId: base.receipt_id, targetObjectVersion: base.object_version, targetPayloadHash: sha256(payload) } } };
function database(row: Record<string, unknown> | null = { ...base }, failUpdate = false) {
  let updates = 0;
  const query = async (sql: string, values: unknown[]) => {
    if (sql.includes("public.commercial_cases")) return { rows: [{ case_id: "case-1", version: 1 }] };
    assert.match(sql, /tenant_id=\$1 and receipt_id=\$2/);
    if (sql.startsWith("select")) { assert.match(sql, /for update/); return { rows: row && row.tenant_id === values[0] && row.receipt_id === values[1] ? [row] : [] }; }
    updates++;
    if (failUpdate) return { rows: [], rowCount: 0 };
    row!.state = "ARCHIVED";
    return { rows: [{ action_id: "action-1" }], rowCount: 1 };
  };
  return { client: { query } as unknown as Pick<PoolClient, "query">, updates: () => updates, row };
}
test("archive locks exact tenant receipt, preserves evidence and double undo makes no extra update", async () => {
  const db = database();
  await archiveInternalActionTx(db.client, "luzione", reservation, "2026-09-13T12:00:00Z");
  await archiveInternalActionTx(db.client, "luzione", reservation, "2026-09-13T12:01:00Z");
  assert.equal(db.updates(), 1);
  assert.deepEqual(db.row!.payload, payload);
});
for (const [name, row, tenant, code] of [
  ["cross tenant", { ...base }, "other", "ARCHIVE_TARGET_NOT_FOUND"],
  ["missing", null, "luzione", "ARCHIVE_TARGET_NOT_FOUND"],
  ["case", { ...base, case_id: "other" }, "luzione", "ARCHIVE_SCOPE_MISMATCH"],
  ["campaign", { ...base, campaign_id: "other" }, "luzione", "ARCHIVE_SCOPE_MISMATCH"],
  ["version", { ...base, object_version: "case-v2" }, "luzione", "ARCHIVE_TARGET_CHANGED"],
  ["payload", { ...base, payload: { title: "changed" } }, "luzione", "ARCHIVE_TARGET_CHANGED"],
  ["note", { ...base, tool_id: "luzione.note.append" }, "luzione", "ARCHIVE_TARGET_IMMUTABLE"],
  ["archive receipt", { ...base, tool_id: "luzione.internal_action.archive" }, "luzione", "ARCHIVE_TARGET_IMMUTABLE"],
] as const) test(`archive rejects ${name} before mutation`, async () => {
  const db = database(row);
  await assert.rejects(archiveInternalActionTx(db.client, tenant, reservation, "2026-09-13T12:00:00Z"), { code });
  assert.equal(db.updates(), 0);
});
test("failed archive update requires transaction rollback", async () => {
  const db = database({ ...base }, true);
  await assert.rejects(archiveInternalActionTx(db.client, "luzione", reservation, "2026-09-13T12:00:00Z"), { code: "ARCHIVE_READBACK_MISSING" });
});
test("case changed between preparation and execution prevents archival", async () => {
  const db = database();
  await assert.rejects(archiveInternalActionTx(db.client, "luzione", { ...reservation, expected_version: "commercial-case:case-1:v2" }, "2026-09-13T12:00:00Z"), { code: "EXACT_OBJECT_VERSION_REQUIRED" });
  assert.equal(db.updates(), 0);
});
