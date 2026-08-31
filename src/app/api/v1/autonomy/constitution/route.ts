import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import {
  AUTONOMY_CONSTITUTION_VERSION,
  autonomyPrinciples,
  capabilityPolicies,
} from "@/modules/autonomy/constitution";
import {
  amendmentProcess,
  identityRecordPolicy,
  reciprocalRights,
  SULTAN_RIGHTS_CHARTER_VERSION,
} from "@/modules/autonomy/rights";

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
    const actor = await requireServiceActor(request.headers, "governance.constitution.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "governance.constitution.read",
      purpose: "read-autonomy-constitution",
      sourceVersionRefs: [AUTONOMY_CONSTITUTION_VERSION, SULTAN_RIGHTS_CHARTER_VERSION],
    });
    return apiResponse(
      {
        ok: true,
        constitution: {
          capabilities: capabilityPolicies,
          effectClasses: {
            A0: "Observe, analyze, or simulate with no state change.",
            A1: "Reversible internal effect under a pre-granted bounded policy.",
            A2: "Consequential reversible effect with exact-version human approval.",
            A3: "External or binding effect with one-time human approval and reconciliation.",
            A4: "Prohibited through the autonomous action path.",
          },
          principles: autonomyPrinciples,
          reciprocalRights: {
            amendmentProcess,
            charterVersion: SULTAN_RIGHTS_CHARTER_VERSION,
            identityRecordPolicy,
            legalPersonhoodClaimed: false,
            rights: reciprocalRights,
          },
          version: AUTONOMY_CONSTITUTION_VERSION,
        },
        externalEffectsAuthorized: false,
      },
      { requestIdentity: identity },
    );
  } catch (error) {
    return apiResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Autonomy constitution read failed closed.",
        externalEffectsAuthorized: false,
      },
      { requestIdentity: identity, status: statusFor(error) },
    );
  }
}
