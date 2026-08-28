import { apiResponse, requestId } from "@/lib/api/http";
import { workflowPacks } from "@/modules/workflows/catalog";

export const dynamic = "force-static";
export const revalidate = 300;

export function GET(request: Request) {
  return apiResponse(
    { ok: true, count: workflowPacks.length, workflowPacks },
    {
      requestId: requestId(request.headers),
      cacheControl: "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
    },
  );
}
