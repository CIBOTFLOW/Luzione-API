import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { readSultanRuntimeStatus } from "@/lib/sultan-runtime/readService";
import { logSultanRuntimeReadbackFailure } from "@/modules/sultan-runtime/readbackFailure";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = createRequestIdentity(request.headers);
  try {
    const result = await readSultanRuntimeStatus();
    return apiResponse(
      {
        ok: true,
        service: "sultan-runtime-readback",
        status: result.overallStatus,
        result,
      },
      { requestIdentity: identity },
    );
  } catch (error) {
    const failure = logSultanRuntimeReadbackFailure({
      error,
      requestIdentity: identity,
      route: "/api/v1/sultan/runtime-status",
    });
    return apiResponse(
      {
        ok: false,
        service: "sultan-runtime-readback",
        status: "UNAVAILABLE",
        message: "Sultan runtime readback failed closed.",
        errorCode: failure.failureCode,
      },
      { requestIdentity: identity, status: 503 },
    );
  }
}
