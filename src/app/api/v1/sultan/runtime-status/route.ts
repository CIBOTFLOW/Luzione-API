import { apiResponse, requestId } from "@/lib/api/http";
import { readSultanRuntimeStatus } from "@/lib/sultan-runtime/readService";
import { logSultanRuntimeReadbackFailure } from "@/modules/sultan-runtime/readbackFailure";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = requestId(request.headers);
  try {
    const result = await readSultanRuntimeStatus();
    return apiResponse(
      {
        ok: true,
        service: "sultan-runtime-readback",
        status: result.overallStatus,
        result,
      },
      { requestId: id },
    );
  } catch (error) {
    const failure = logSultanRuntimeReadbackFailure({
      error,
      requestId: id,
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
      { requestId: id, status: 503 },
    );
  }
}
