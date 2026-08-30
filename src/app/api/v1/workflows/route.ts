import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { workflowPacks } from "@/modules/workflows/catalog";

export const dynamic = "force-static";
export const revalidate = 300;

export function GET(request: Request) {
  const identity = createRequestIdentity(request.headers);
  return apiResponse(
    { ok: true, count: workflowPacks.length, workflowPacks },
    {
      requestIdentity: identity,
      cacheControl: "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
    },
  );
}
