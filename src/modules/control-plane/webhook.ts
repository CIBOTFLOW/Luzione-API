import crypto from "node:crypto";

import type { ProviderWebhookInput } from "./providerAdapter";

const CODE_PATTERN = /^[a-z][a-z0-9._-]{0,199}$/;
const EVENT_PATTERN = /^[A-Za-z0-9._:@/-]{1,500}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MAX_WEBHOOK_BYTES = 1_048_576;

export type WebhookVerification = {
  connectionId: string;
  correlationId: string;
  deduplicationKey: string;
  eventType: string;
  providerEventId: string;
  signatureStatus: "REJECTED" | "VERIFIED";
  tenantId: string;
};

export interface ProviderWebhookVerifier {
  verify(input: ProviderWebhookInput): Promise<WebhookVerification>;
}

export class ProviderWebhookRegistry {
  readonly #verifiers = new Map<string, ProviderWebhookVerifier>();

  register(provider: string, verifier: ProviderWebhookVerifier) {
    if (!CODE_PATTERN.test(provider)) throw new Error("Webhook provider code is invalid.");
    if (this.#verifiers.has(provider)) throw new Error(`Webhook verifier already registered: ${provider}`);
    this.#verifiers.set(provider, verifier);
  }

  get(provider: string) {
    return this.#verifiers.get(provider);
  }

  providers() {
    return [...this.#verifiers.keys()].sort();
  }
}

export type HmacEndpoint = {
  connectionId: string;
  secret: string;
  tenantId: string;
};

function header(headers: Readonly<Record<string, string>>, name: string) {
  return headers[name] ?? headers[name.toLowerCase()] ?? "";
}

function sha256(value: crypto.BinaryLike) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function validUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export class HmacSha256WebhookVerifier implements ProviderWebhookVerifier {
  constructor(private readonly resolveEndpoint: (endpointKey: string) => Promise<HmacEndpoint | null>) {}

  async verify(input: ProviderWebhookInput): Promise<WebhookVerification> {
    const endpointKey = header(input.headers, "x-luzione-webhook-endpoint");
    if (!EVENT_PATTERN.test(endpointKey)) throw new Error("Webhook endpoint identity is missing or invalid.");
    const endpoint = await this.resolveEndpoint(endpointKey);
    if (!endpoint || !validUuid(endpoint.tenantId) || !validUuid(endpoint.connectionId) || !endpoint.secret) {
      throw new Error("Webhook endpoint identity could not be resolved.");
    }
    const declaredEventId = header(input.headers, "x-provider-event-id");
    const declaredEventType = header(input.headers, "x-provider-event-type");
    const providerEventId = EVENT_PATTERN.test(declaredEventId) ? declaredEventId : `rejected:${sha256(input.body).slice(0, 48)}`;
    const eventType = CODE_PATTERN.test(declaredEventType) ? declaredEventType : "unclassified";
    const supplied = header(input.headers, "x-provider-signature").replace(/^sha256=/, "").toLowerCase();
    const expected = crypto.createHmac("sha256", endpoint.secret).update(input.body).digest("hex");
    const signatureStatus = /^[a-f0-9]{64}$/.test(supplied)
      && crypto.timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"))
      ? "VERIFIED"
      : "REJECTED";
    const deduplicationKey = sha256(`${endpoint.tenantId}:${endpoint.connectionId}:${providerEventId}`);
    return {
      connectionId: endpoint.connectionId,
      correlationId: `webhook:${deduplicationKey.slice(0, 40)}`,
      deduplicationKey,
      eventType,
      providerEventId,
      signatureStatus,
      tenantId: endpoint.tenantId,
    };
  }
}

export function webhookHeaders(headers: Headers) {
  const safe: Record<string, string> = {};
  for (const name of [
    "x-luzione-webhook-endpoint",
    "x-provider-event-id",
    "x-provider-event-type",
    "x-provider-signature",
  ]) {
    const value = headers.get(name);
    if (value) safe[name] = value;
  }
  return safe;
}

export async function readBoundedWebhookBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) throw new Error("Webhook body is too large.");
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_WEBHOOK_BYTES) throw new Error("Webhook body is too large.");
  return body;
}

export const providerWebhookRegistry = new ProviderWebhookRegistry();
