import type { PoolClient } from "pg";
import { SultanAgentGatewayError } from "./contracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";

export async function archiveInternalActionTx(client: Pick<PoolClient, "query">, tenantId: string, reservation: { case_id: string; case_type: string; preview: Readonly<Record<string, unknown>>; expected_version: string }, now: string) {
  const current = await client.query("select case_id,version from public.commercial_cases where tenant_id=$1 and case_id=$2 for share", [tenantId, reservation.case_id]);
  if (!current.rows[0] || `commercial-case:${current.rows[0].case_id}:v${Number(current.rows[0].version)}` !== reservation.expected_version) throw new SultanAgentGatewayError("EXACT_OBJECT_VERSION_REQUIRED", "The case changed after preparation; prepare a new archival command.", 409);
  const args = reservation.preview.payload as Record<string, unknown>;
  const result = await client.query(
    "select * from public.sultan_agent_internal_actions where tenant_id=$1 and receipt_id=$2 for update",
    [tenantId, args.targetReceiptId],
  );
  const target = result.rows[0];
  if (!target) throw new SultanAgentGatewayError("ARCHIVE_TARGET_NOT_FOUND", "The internal action was not found.", 404);
  if (target.case_id !== reservation.case_id || target.case_type !== reservation.case_type || target.campaign_id !== args.campaignId) throw new SultanAgentGatewayError("ARCHIVE_SCOPE_MISMATCH", "The target is outside the approved case or campaign.", 409);
  if (!["luzione.task.create", "luzione.gmail_draft.create", "luzione.proposal_revision.create"].includes(target.tool_id)) throw new SultanAgentGatewayError("ARCHIVE_TARGET_IMMUTABLE", "This evidence cannot be archived.", 403);
  if (target.object_version !== args.targetObjectVersion || sha256(target.payload) !== args.targetPayloadHash) throw new SultanAgentGatewayError("ARCHIVE_TARGET_CHANGED", "Refresh the exact target evidence before preparing archival.", 409);
  if (target.state === "ARCHIVED") return;
  if (target.state !== "SOURCE_CONFIRMED") throw new SultanAgentGatewayError("ARCHIVE_STATE_INVALID", "The target cannot be archived in its current state.", 409);
  const updated = await client.query(
    "update public.sultan_agent_internal_actions set state='ARCHIVED', archived_at=$3 where tenant_id=$1 and receipt_id=$2 and state='SOURCE_CONFIRMED' returning action_id",
    [tenantId, args.targetReceiptId, now],
  );
  if (updated.rowCount !== 1) throw new SultanAgentGatewayError("ARCHIVE_READBACK_MISSING", "Archival was not observed; the transaction must roll back.", 503);
}
