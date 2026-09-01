import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import {
  customerProfiles,
  marketRollout,
  PRODUCT_CATALOG_CONTRACT_VERSION,
  productEditions,
  productModules,
} from "@/modules/productization/catalog";
import {
  licensingLaw,
  TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION,
} from "@/modules/productization/licensing";
import {
  ROOM_PLAN_PROPOSAL_ATTACHMENT_CONTRACT_VERSION,
  roomPlannerProposalBridge,
} from "@/modules/productization/roomPlannerProposal";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const identity = createRequestIdentity(request.headers);
  return apiResponse(
    {
      ok: true,
      productCatalog: {
        contractVersion: PRODUCT_CATALOG_CONTRACT_VERSION,
        customerProfiles,
        editions: productEditions,
        marketRollout,
        modules: productModules,
      },
      licensing: {
        contractVersion: TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION,
        law: licensingLaw,
        tenantReadbackRoute: "GET /api/v1/licensing/entitlements",
        tenantEntitlementsExposed: false,
      },
      roomPlannerProposal: {
        bridge: roomPlannerProposalBridge,
        contractVersion: ROOM_PLAN_PROPOSAL_ATTACHMENT_CONTRACT_VERSION,
      },
    },
    {
      requestIdentity: identity,
      cacheControl: "no-store",
    },
  );
}
