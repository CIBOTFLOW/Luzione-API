import crypto from "node:crypto";

export type ApiActor = {
  actorId: string;
  actorType: "agent" | "service" | "user";
  source: "service-token";
  tenantId: string;
};

function safeEqual(received: string, expected: string) {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && crypto.timingSafeEqual(receivedBytes, expectedBytes);
}

export function requireServiceActor(headers: Headers): ApiActor {
  const configured = process.env.LUZIONE_API_SERVICE_TOKEN?.trim();
  if (!configured) throw new Error("Service authentication is not configured.");
  const authorization = headers.get("authorization") ?? "";
  const received = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!received || !safeEqual(received, configured)) throw new Error("Service authentication failed.");

  const tenantId = headers.get("x-luzione-tenant")?.trim();
  const actorId = headers.get("x-luzione-actor")?.trim();
  const actorType = headers.get("x-luzione-actor-type")?.trim();
  if (!tenantId || !actorId) throw new Error("Tenant and actor headers are required.");
  if (actorType !== "agent" && actorType !== "service" && actorType !== "user") {
    throw new Error("Actor type must be agent, service or user.");
  }
  return { actorId, actorType, source: "service-token", tenantId };
}
