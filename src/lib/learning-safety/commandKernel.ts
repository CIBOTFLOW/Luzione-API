import "server-only";

import type { CanonicalActor } from "@/lib/control-plane/actor";
import { ControlPlaneStoreError } from "@/lib/control-plane/store";
import { databasePool } from "@/lib/db";

function postgresCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

export async function applyLearningCommand(
  actor: CanonicalActor,
  commandId: string,
) {
  if (!/^cmd:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
    throw new Error("A canonical learning command id is required.");
  }
  let result: { rows: Array<{ receipt: Record<string, unknown> }> };
  try {
    result = await databasePool().query<{ receipt: Record<string, unknown> }>(
      "select public.apply_learning_command($1::uuid, $2::text, $3::text) as receipt",
      [actor.tenantId, commandId, actor.principal.identityId],
    );
  } catch (error) {
    const code = postgresCode(error);
    if (code === "P0002") {
      throw new ControlPlaneStoreError(
        "LEARNING_COMMAND_NOT_FOUND",
        "The canonical learning command, candidate, or evaluation was not found.",
        404,
      );
    }
    if (code === "42501") {
      throw new ControlPlaneStoreError(
        "LEARNING_COMMAND_DENIED",
        "The learning transition is not currently authorized.",
        403,
      );
    }
    if (["23505", "23514", "55000"].includes(code ?? "")) {
      throw new ControlPlaneStoreError(
        "LEARNING_COMMAND_CONFLICT",
        "The learning transition is stale, blocked, or conflicts with authoritative state.",
        409,
      );
    }
    if (code === "22023") {
      throw new ControlPlaneStoreError(
        "LEARNING_COMMAND_INVALID",
        "The learning transition identifier is invalid.",
        400,
      );
    }
    throw error;
  }
  if (result.rows.length !== 1 || !result.rows[0].receipt) {
    throw new Error("Learning command execution did not return authoritative readback.");
  }
  return result.rows[0].receipt;
}
