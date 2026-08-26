import { apiResponse, requestId } from "@/lib/api/http";
import { requireServiceActor } from "@/lib/api/actor";
import { runtimeConfig } from "@/lib/api/config";
import { readPlatformGuaranteeSummary } from "@/lib/platform-guarantees/readService";

export const dynamic = "force-dynamic";

function statusFor(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown failure";
  if (/authentication|tenant|actor/i.test(message)) return 401;
  if (/not configured/i.test(message)) return 503;
  return 503;
}

export async function GET(request: Request) {
  const id = requestId(request.headers);
  try {
    const actor = await requireServiceActor(request.headers);
    const result = await readPlatformGuaranteeSummary(actor);
    return apiResponse({ ok: true, result }, { requestId: id });
  } catch (error) {
    return apiResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Platform guarantee read failed closed.",
      },
      { requestId: id, status: statusFor(error) },
    );
  }
}

export async function POST(request: Request) {
  const id = requestId(request.headers);
  const config = runtimeConfig();
  if (!config.mutationsEnabled) {
    return apiResponse(
      {
        ok: false,
        code: "MUTATIONS_DISABLED",
        message: "API mutations remain disabled until canonical database, actor authority, idempotency and recovery are verified.",
        externalEffectsAuthorized: false,
      },
      { requestId: id, status: 503 },
    );
  }
  return apiResponse(
    {
      ok: false,
      code: "COMMAND_EXTRACTION_PENDING",
      message: "Mutation routing is enabled by configuration, but the P110 command service has not been activated in this deployment.",
      externalEffectsAuthorized: false,
    },
    { requestId: id, status: 501 },
  );
}
