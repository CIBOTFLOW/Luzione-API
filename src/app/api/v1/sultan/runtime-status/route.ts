import { apiResponse, requestId } from "@/lib/api/http";
import { readSultanRuntimeStatus } from "@/lib/sultan-runtime/readService";

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
  } catch {
    return apiResponse(
      {
        ok: false,
        service: "sultan-runtime-readback",
        status: "UNAVAILABLE",
        message: "Sultan runtime readback failed closed.",
      },
      { requestId: id, status: 503 },
    );
  }
}
