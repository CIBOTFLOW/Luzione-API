import "server-only";

import type { Pool, PoolClient } from "pg";

import { requireServiceActor, type ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import type { AuthenticatedPrincipal } from "@/modules/control-plane/types";

export class CanonicalActorError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

export type CanonicalActor = {
  legacyTenantId: string;
  membershipCapabilities: string[];
  principal: AuthenticatedPrincipal;
  tenantCode: string;
  tenantId: string;
};

type Queryable = Pick<Pool | PoolClient, "query">;

const CONNECTION_ADMIN_ROLES = new Set([
  "ADMIN",
  "ADMINISTRATOR",
  "OWNER",
  "TENANT_ADMIN",
  "TENANT_OWNER",
]);

function normalizedRole(role: string) {
  return role.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function membershipCapabilities(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length <= 200);
}

export function canAdministerConnections(actor: CanonicalActor) {
  return CONNECTION_ADMIN_ROLES.has(normalizedRole(actor.principal.membershipRole))
    || actor.membershipCapabilities.some((capability) => [
      "connections.manage",
      "platform.admin",
      "tenant.connections.manage",
    ].includes(capability));
}

export function requireConnectionAdministrator(actor: CanonicalActor) {
  if (!canAdministerConnections(actor)) {
    throw new CanonicalActorError(
      "TENANT_ADMIN_REQUIRED",
      "An active tenant administrator membership is required to manage connections.",
      403,
    );
  }
  return actor;
}

export function requireWorkloadCapability(actor: CanonicalActor, capability: string) {
  if (actor.principal.principalType === "USER") return actor;
  if (!actor.membershipCapabilities.includes(capability)) {
    throw new CanonicalActorError(
      "WORKLOAD_CAPABILITY_REQUIRED",
      `The authenticated workload is not permitted to use ${capability}.`,
      403,
    );
  }
  return actor;
}

function identityId(actor: ApiActor) {
  if (/^(user|service|agent):/.test(actor.actorId)) return actor.actorId;
  if (actor.actorType === "user") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actor.actorId)) {
      throw new CanonicalActorError("IDENTITY_INVALID", "The authenticated user identity is invalid.", 401);
    }
    return `user:${actor.actorId}`;
  }
  if (!/^[A-Za-z0-9._:@-]{1,190}$/.test(actor.actorId)) {
    throw new CanonicalActorError("IDENTITY_INVALID", "The authenticated workload identity is invalid.", 401);
  }
  return `${actor.actorType}:${actor.actorId}`;
}

function principalType(actorType: ApiActor["actorType"]): AuthenticatedPrincipal["principalType"] {
  return actorType === "user" ? "USER" : actorType === "agent" ? "AGENT" : "SERVICE";
}

export async function resolveCanonicalActor(actor: ApiActor, database: Queryable = databasePool()) {
  const normalizedIdentityId = identityId(actor);
  const result = await database.query<{
    capabilities: unknown;
    identity_type: AuthenticatedPrincipal["principalType"];
    role: string;
    tenant_code: string;
    tenant_id: string;
  }>(
    `select
       membership.capabilities,
       identity.identity_type,
       membership.role,
       tenant.code as tenant_code,
       tenant.tenant_id::text as tenant_id
     from public.platform_identities identity
     join public.tenant_memberships membership
       on membership.identity_id = identity.identity_id
      and membership.status = 'ACTIVE'
     join public.tenant_accounts tenant
       on tenant.tenant_id = membership.tenant_id
      and tenant.status = 'ACTIVE'
     left join public.tenant_legacy_id_mappings legacy
       on legacy.canonical_tenant_id = tenant.tenant_id
     where identity.identity_id = $1
       and identity.status = 'ACTIVE'
       and (
         tenant.tenant_id::text = $2
         or tenant.code = $2
         or legacy.legacy_tenant_id = $2
       )
     order by tenant.tenant_id
     limit 2`,
    [normalizedIdentityId, actor.tenantId],
  );
  if (result.rows.length !== 1) {
    throw new CanonicalActorError(
      "ACTIVE_MEMBERSHIP_REQUIRED",
      "The authenticated principal does not have one unambiguous active membership for this tenant context.",
      403,
    );
  }
  const row = result.rows[0];
  if (row.identity_type !== principalType(actor.actorType)) {
    throw new CanonicalActorError("IDENTITY_TYPE_MISMATCH", "The authenticated principal type does not match the canonical identity.", 403);
  }
  return {
    legacyTenantId: actor.tenantId,
    membershipCapabilities: membershipCapabilities(row.capabilities),
    principal: {
      identityId: normalizedIdentityId,
      membershipRole: row.role,
      principalType: row.identity_type,
    },
    tenantCode: row.tenant_code,
    tenantId: row.tenant_id,
  } satisfies CanonicalActor;
}

export async function requireCanonicalActor(headers: Headers, database: Queryable = databasePool()) {
  let actor: ApiActor;
  try {
    actor = await requireServiceActor(headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Service authentication failed.";
    throw new CanonicalActorError("SERVICE_AUTH_FAILED", message, /not configured/i.test(message) ? 503 : 401);
  }
  return resolveCanonicalActor(actor, database);
}
