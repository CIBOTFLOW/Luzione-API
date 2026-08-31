import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { databasePool } from "@/lib/db";
import { PostgresWorkflowDeliveryStore, WORKFLOW_DELIVERY_CONTRACT_VERSION } from "@/lib/platform-guarantees/postgresWorkflowDeliveryStore";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { PROVIDER_ADAPTER_CONTRACT_VERSION } from "@/modules/provider-runtime/contracts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "provider_operations.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "provider_operations.read",
      purpose: "read-tenant-provider-worker-state",
      sourceVersionRefs: [PROVIDER_ADAPTER_CONTRACT_VERSION, WORKFLOW_DELIVERY_CONTRACT_VERSION],
    });
    const result = await new PostgresWorkflowDeliveryStore(databasePool()).readProviderOperations({ tenantId: actor.tenantId });
    return apiResponse({ ok: true, providerAdapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION, result }, { requestIdentity: identity });
  } catch (error) {
    const authentication = error instanceof Error && /authentication|credential|required capability/i.test(error.message);
    return apiResponse(
      { ok: false, code: authentication ? "SERVICE_AUTH_FAILED" : "PROVIDER_OPERATIONS_UNAVAILABLE", message: authentication ? "Service authentication is required." : "Provider operations readback is unavailable." },
      { requestIdentity: identity, status: authentication ? 401 : 503 },
    );
  }
}
