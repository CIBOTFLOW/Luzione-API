import { apiResponse, requestId } from "@/lib/api/http";
import { canonicalObjects, platformAreas } from "@/lib/platformCatalog";

export async function GET(request: Request) {
  const id = requestId(request.headers);
  return apiResponse(
    {
      ok: true,
      contractVersion: "1.0",
      canonicalObjects,
      platformAreas,
      authority: {
        app: "Human records, queues, actions, documents and approvals",
        api: "Deterministic truth, commands, events, workflow, integration, access, reliability and audit",
        os: "Reasoning, agents, tools, models, memory, simulations and AI governance",
      },
    },
    { requestId: id },
  );
}
