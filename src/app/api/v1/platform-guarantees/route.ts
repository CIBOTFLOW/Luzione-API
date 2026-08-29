import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { requireServiceActor } from "@/lib/api/actor";
import { runtimeConfig } from "@/lib/api/config";
import { readPlatformGuaranteeSummary } from "@/lib/platform-guarantees/readService";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";

function statusFor(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown failure";
  if (/authentication|tenant|actor/i.test(message)) return 401;
  if (/not configured/i.test(message)) return 503;
  return 503;
}

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers);
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "platform.guarantees.read",
      purpose: "read-platform-guarantees",
    });
    const result = await readPlatformGuaranteeSummary(actor);
    return apiResponse({ ok: true, result }, { requestIdentity: identity });
  } catch (error) {
    return apiResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Platform guarantee read failed closed.",
      },
      { requestIdentity: identity, status: statusFor(error) },
    );
  }
}

export async function POST(request: Request) {
  const identity = createRequestIdentity(request.headers);
  const config = runtimeConfig();
  if (!config.mutationsEnabled) {
    return apiResponse(
      {
        ok: false,
        code: "MUTATIONS_DISABLED",
        message: "API mutations remain disabled until canonical database, actor authority, idempotency and recovery are verified.",
        externalEffectsAuthorized: false,
      },
      { requestIdentity: identity, status: 503 },
    );
  }
  return apiResponse(
    {
      ok: false,
      code: "COMMAND_EXTRACTION_PENDING",
      message: "Mutation routing is enabled by configuration, but the P110 command service has not been activated in this deployment.",
      externalEffectsAuthorized: false,
    },
    { requestIdentity: identity, status: 501 },
  );
}
