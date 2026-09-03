import type { ApiActor } from "@/lib/api/actor";

export function isExactStage5ConsumerWorkload(actor: ApiActor, capability: string) {
  const actorAllowed = capability === "sultan.stage5.admission.request"
    ? actor.actorId === "service:sultan-os"
    : actor.actorId === "service:luzione-ui" || actor.actorId === "service:sultan-os";
  return actor.source === "vercel-oidc"
    && actor.actorType === "service"
    && actorAllowed
    && actor.tenantId === "luzione"
    && actor.capabilities.includes(capability);
}
