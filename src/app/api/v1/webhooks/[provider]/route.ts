import { apiResponse, requestId } from "@/lib/api/http";
import { ControlPlaneRequestError } from "@/modules/control-plane/request";
import { controlPlaneFailure } from "@/lib/control-plane/http";
import { ensureRuntimeWebhookProvider } from "@/lib/control-plane/webhookRuntime";
import { persistWebhookReceipt } from "@/lib/control-plane/webhookStore";
import {
  providerWebhookRegistry,
  readBoundedWebhookBody,
  webhookHeaders,
} from "@/modules/control-plane/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const id = requestId(request.headers);
  try {
    const { provider } = await context.params;
    if (!/^[a-z][a-z0-9._-]{0,199}$/.test(provider)) {
      throw new ControlPlaneRequestError("INVALID_PATH", "provider is invalid.");
    }
    ensureRuntimeWebhookProvider(provider);
    const verifier = providerWebhookRegistry.get(provider);
    if (!verifier) {
      return apiResponse(
        {
          ok: false,
          code: "WEBHOOK_ADAPTER_NOT_ACTIVATED",
          message: `The ${provider} webhook adapter is not activated. The body was not accepted or persisted.`,
          externalEffectsAuthorized: false,
        },
        { requestId: id, status: 501 },
      );
    }
    const body = await readBoundedWebhookBody(request);
    const verification = await verifier.verify({
      body,
      headers: webhookHeaders(request.headers),
      receivedAt: new Date().toISOString(),
    });
    const durable = await persistWebhookReceipt({ body, provider, verification });
    if (verification.signatureStatus !== "VERIFIED") {
      return apiResponse(
        {
          ok: false,
          code: "WEBHOOK_SIGNATURE_REJECTED",
          message: "Webhook signature verification failed. The digest-only rejection receipt was preserved.",
          receiptId: durable.receipt.webhook_receipt_id,
          externalEffectsAuthorized: false,
        },
        { requestId: id, status: 401 },
      );
    }
    return apiResponse(
      {
        ok: true,
        contractVersion: "luzione-webhooks/v1",
        duplicate: durable.duplicate,
        receiptId: durable.receipt.webhook_receipt_id,
        state: durable.duplicate ? "DUPLICATE" : "RECEIVED",
        processing: "ASYNCHRONOUS",
        externalEffectsAuthorized: false,
      },
      { requestId: id, status: durable.duplicate ? 200 : 202 },
    );
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
