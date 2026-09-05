import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  LEGACY_PROVIDER_ADAPTER_CONTRACT_VERSION,
  ProviderContractError,
  type PreparedProviderRequest,
  type ProviderMessage,
  type ProviderObservationResult,
} from "@/modules/provider-runtime/contracts";
import {
  SULTAN_RFQ_CANARY_DESTINATION,
  SULTAN_RFQ_CANARY_RECIPIENT,
  SULTAN_RFQ_CANARY_SUBJECT_PREFIX,
} from "@/modules/sultan-agent-gateway/registry";

export type OpaqueCredentialResolver = (input: {
  credentialBindingId: string;
  destination: string;
  effectAdmissionRef: string;
  provider: string;
  tenantId: string;
}) => Promise<string | null>;

export type GmailRfqCanaryBinding = {
  credentialBindingId: string;
  resolveCredential: OpaqueCredentialResolver;
  sender: string;
};

/**
 * Historical v0.2 canary adapter retained for bounded compatibility tests.
 * It deliberately does not implement ProviderAdapter v0.3 and cannot be
 * registered by the corrected sandbox-only worker.
 */
export class GmailRfqCanaryAdapter {
  readonly credentialBindingId: string;
  readonly destination = SULTAN_RFQ_CANARY_DESTINATION;
  readonly mode = "LIVE" as const;
  readonly provider = "gmail";

  constructor(
    private readonly binding: GmailRfqCanaryBinding,
    private readonly providerFetch: typeof fetch = fetch,
  ) {
    this.credentialBindingId = binding.credentialBindingId;
  }

  async prepare(message: ProviderMessage): Promise<PreparedProviderRequest> {
    if (message.destination !== this.destination
      || message.effectClass !== "EXTERNAL_EFFECT"
      || !message.authorizationRef?.startsWith("sultan-rfq-envelope:")) {
      throw new ProviderContractError("RFQ_CANARY_AUTHORITY_INVALID", "The Gmail RFQ adapter requires an exact durable policy-envelope reference.");
    }
    const payload = parsePayload(message.payload);
    const configuredSender = this.binding.sender.trim().toLowerCase();
    if (!configuredSender || !emailAddress(configuredSender) || payload.sender.toLowerCase() !== configuredSender) {
      throw new ProviderContractError("RFQ_CANARY_SENDER_DENIED", "The RFQ canary sender does not match the configured Luzione sender.");
    }
    const raw = encodeMimeMessage(payload);
    const rfc822MessageId = stableMessageId(payload.operationId);
    return {
      contractVersion: LEGACY_PROVIDER_ADAPTER_CONTRACT_VERSION,
      credentialBindingId: this.credentialBindingId,
      destination: this.destination,
      effectAdmissionRef: requiredAdmission(message.effectAdmissionRef ?? null),
      idempotencyKey: message.idempotencyKey,
      objectRef: `${message.objectType}:${message.objectId}`,
      payload: {
        raw,
        operationId: payload.operationId,
        rfc822MessageId,
        sender: payload.sender,
        recipient: payload.recipient,
        subject: payload.subject,
      },
      payloadHash: sha256({ raw, operationId: payload.operationId, rfc822MessageId, sender: payload.sender }),
      provider: this.provider,
      providerRequestRef: `gmail:send:${sha256([message.idempotencyKey, payload.operationId]).slice(0, 32)}`,
      resultingObjectVersion: message.resultingObjectVersion,
      tenantId: message.tenantId,
    };
  }

  async execute(request: PreparedProviderRequest) {
    const token = await this.resolveCredential(request);
    const sender = required(request.payload.sender, "sender", 320);
    const raw = required(request.payload.raw, "raw", 20_000);
    if (!token) {
      return {
        state: "FAILED" as const,
        errorCode: "GMAIL_CREDENTIAL_UNAVAILABLE",
        failureClass: "PERMANENT" as const,
        safeSummary: "The API-owned Gmail canary credential is unavailable.",
      };
    }
    let response: Response;
    try {
      response = await this.providerFetch(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(sender)}/messages/send`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ raw }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      return {
        state: "FAILED" as const,
        errorCode: "GMAIL_SEND_OUTCOME_UNKNOWN",
        failureClass: "AMBIGUOUS_AFTER_ACK" as const,
        safeSummary: "The Gmail send outcome is unknown; reconciliation is required and automatic resend is prohibited.",
      };
    }
    if (!response.ok) {
      const rateLimited = response.status === 429;
      return {
        state: "FAILED" as const,
        errorCode: rateLimited ? "GMAIL_RATE_LIMITED" : "GMAIL_SEND_REJECTED_OR_UNKNOWN",
        failureClass: rateLimited ? "RATE_LIMITED" as const : response.status >= 500 ? "AMBIGUOUS_AFTER_ACK" as const : "PERMANENT" as const,
        retryAfterMs: null,
        safeSummary: rateLimited
          ? "Gmail rate-limited the canary; the one-attempt envelope prohibits automatic resend."
          : "Gmail did not return a successful acceptance receipt.",
      };
    }
    const body = await safeJson(response);
    const messageId = record(body) && typeof body.id === "string" && /^[A-Za-z0-9_-]{2,300}$/.test(body.id)
      ? body.id
      : null;
    if (!messageId) {
      return {
        state: "FAILED" as const,
        errorCode: "GMAIL_ACCEPTANCE_RECEIPT_INVALID",
        failureClass: "AMBIGUOUS_AFTER_ACK" as const,
        safeSummary: "Gmail accepted the request without a valid message identity; reconciliation is required.",
      };
    }
    return { state: "ACKNOWLEDGED" as const, acknowledgementRef: `gmail:message:${messageId}` };
  }

  async observe(request: PreparedProviderRequest, acknowledgementRef: string) {
    const messageId = parseAcknowledgement(acknowledgementRef);
    if (!messageId) return { result: "AMBIGUOUS" as const, notes: "The Gmail acknowledgement reference is invalid." };
    return this.observeMessage(request, messageId);
  }

  async reconcile(request: PreparedProviderRequest): Promise<ProviderObservationResult> {
    const token = await this.resolveCredential(request);
    const sender = required(request.payload.sender, "sender", 320);
    const operationId = required(request.payload.operationId, "operationId", 512);
    if (!token) return { result: "SOURCE_UNAVAILABLE", notes: "The API-owned Gmail canary credential is unavailable." };
    let response: Response;
    try {
      const query = new URLSearchParams({ q: `in:sent rfc822msgid:${stableMessageId(operationId).slice(1, -1)}`, maxResults: "2" });
      response = await this.providerFetch(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(sender)}/messages?${query}`,
        { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) },
      );
    } catch {
      return { result: "SOURCE_UNAVAILABLE", notes: "Gmail reconciliation is temporarily unavailable; no retry is authorized." };
    }
    if (!response.ok) return { result: "SOURCE_UNAVAILABLE", notes: "Gmail reconciliation did not return authoritative state." };
    const body = await safeJson(response);
    const messages = record(body) && Array.isArray(body.messages) ? body.messages : [];
    const ids = messages.flatMap((item) => record(item) && typeof item.id === "string" ? [item.id] : []);
    if (ids.length === 0) return { result: "NOT_FOUND", notes: "No exact sent message was observed. Automatic resend remains prohibited." };
    if (ids.length !== 1) return { result: "AMBIGUOUS", notes: "Multiple messages matched the stable operation identity; operator reconciliation is required." };
    return this.observeMessage(request, ids[0]);
  }

  async compensate() {
    return { state: "NOT_SUPPORTED" as const, reason: "Email transmission is irreversible; containment is prevention and reconciliation." };
  }

  private async observeMessage(request: PreparedProviderRequest, messageId: string): Promise<ProviderObservationResult> {
    const token = await this.resolveCredential(request);
    const sender = required(request.payload.sender, "sender", 320);
    if (!token) return { result: "SOURCE_UNAVAILABLE", notes: "The API-owned Gmail canary credential is unavailable." };
    const query = new URLSearchParams();
    query.set("format", "metadata");
    for (const name of ["To", "From", "Subject", "Message-ID", "X-Sultan-Operation-Id"]) query.append("metadataHeaders", name);
    let response: Response;
    try {
      response = await this.providerFetch(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(sender)}/messages/${encodeURIComponent(messageId)}?${query}`,
        { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) },
      );
    } catch {
      return { result: "SOURCE_UNAVAILABLE", notes: "Gmail readback is temporarily unavailable." };
    }
    if (response.status === 404) return { result: "NOT_FOUND", notes: "Gmail did not contain the accepted message identity." };
    if (!response.ok) return { result: "SOURCE_UNAVAILABLE", notes: "Gmail readback did not return authoritative state." };
    const body = await safeJson(response);
    const headers = record(body) && record(body.payload) && Array.isArray(body.payload.headers)
      ? body.payload.headers
      : [];
    const byName = new Map(headers.flatMap((item) => record(item) && typeof item.name === "string" && typeof item.value === "string"
      ? [[item.name.toLowerCase(), item.value] as const]
      : []));
    const matches = byName.get("to")?.toLowerCase() === SULTAN_RFQ_CANARY_RECIPIENT
      && byName.get("subject") === request.payload.subject
      && byName.get("message-id") === request.payload.rfc822MessageId
      && byName.get("x-sultan-operation-id") === request.payload.operationId;
    if (!matches) return { result: "VERSION_MISMATCH", notes: "Gmail readback does not match recipient, subject, and operation identity." };
    return {
      result: "MATCHED",
      observedObjectVersion: request.resultingObjectVersion,
      sourceReadbackRef: `gmail:message:${messageId}`,
      notes: "Gmail contains the exact sent-message record. This proves provider acceptance/readback, not recipient delivery.",
    };
  }

  private async resolveCredential(request: PreparedProviderRequest) {
    if (request.credentialBindingId !== this.credentialBindingId
      || request.destination !== this.destination
      || request.provider !== this.provider
      || !/^effect-admission:[a-f0-9]{64}$/.test(request.effectAdmissionRef)) {
      return null;
    }
    const value = await this.binding.resolveCredential({
      credentialBindingId: request.credentialBindingId,
      destination: request.destination,
      effectAdmissionRef: request.effectAdmissionRef,
      provider: request.provider,
      tenantId: request.tenantId,
    });
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
}

function requiredAdmission(value: string | null) {
  if (!value || !/^effect-admission:[a-f0-9]{64}$/.test(value)) {
    throw new ProviderContractError("EFFECT_ADMISSION_REQUIRED", "The Gmail request requires an exact effect-admission decision reference.");
  }
  return value;
}

function parsePayload(value: Record<string, unknown>) {
  if (value.contractVersion !== "luzione-sultan-rfq-canary-message/v1"
    || value.recipient !== SULTAN_RFQ_CANARY_RECIPIENT
    || typeof value.subject !== "string"
    || !value.subject.startsWith(SULTAN_RFQ_CANARY_SUBJECT_PREFIX)
    || value.contentClass !== "SYNTHETIC_ALLOWLISTED_SUPPLIER_RFQ"
    || !Array.isArray(value.attachments) || value.attachments.length !== 0
    || !Array.isArray(value.trackingLinks) || value.trackingLinks.length !== 0
    || !Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0) {
    throw new ProviderContractError("RFQ_CANARY_PAYLOAD_INVALID", "The durable RFQ canary payload is outside the exact provider contract.");
  }
  const sender = required(value.sender, "sender", 320);
  if (!emailAddress(sender)) throw new ProviderContractError("RFQ_CANARY_SENDER_DENIED", "The RFQ canary sender is invalid.");
  const subject = required(value.subject, "subject", 180);
  const bodyText = required(value.bodyText, "bodyText", 5_000);
  const operationId = required(value.operationId, "operationId", 512);
  return { sender, recipient: SULTAN_RFQ_CANARY_RECIPIENT, subject, bodyText, operationId };
}

function encodeMimeMessage(input: { sender: string; recipient: string; subject: string; bodyText: string; operationId: string }) {
  const subject = Buffer.from(input.subject, "utf8").toString("base64");
  const marker = `Sultan-Operation-Id: ${input.operationId}`;
  const mime = [
    `From: ${input.sender}`,
    `To: ${input.recipient}`,
    `Subject: =?UTF-8?B?${subject}?=`,
    `Message-ID: ${stableMessageId(input.operationId)}`,
    `X-Sultan-Operation-Id: ${input.operationId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.bodyText,
    "",
    marker,
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}

function stableMessageId(operationId: string) {
  return `<sultan-rfq-${sha256(operationId).slice(0, 40)}@luzione.com>`;
}

function emailAddress(value: string) {
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(value);
}

function parseAcknowledgement(value: string) {
  const match = /^gmail:message:([A-Za-z0-9_-]{2,300})$/.exec(value);
  return match?.[1] ?? null;
}

function required(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ProviderContractError("RFQ_CANARY_PAYLOAD_INVALID", `${field} is invalid.`);
  }
  return value.trim();
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
