import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { readTenantLicenseSnapshot } from "@/lib/productization/licenseReadService";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import {
  evaluateLicensedModuleAccess,
  licenseAccessModes,
  TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION,
  type LicenseAccessMode,
} from "@/modules/productization/licensing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  let actor: Awaited<ReturnType<typeof requireServiceActor>>;
  try {
    actor = await requireServiceActor(request.headers, "license.entitlement.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "license.entitlement.read",
      purpose: "read-canonical-license-entitlements",
      sourceVersionRefs: [TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION],
    });
  } catch {
    return apiResponse(
      { ok: false, code: "LICENSE_AUTHENTICATION_REQUIRED", message: "Service authentication required." },
      { requestIdentity: identity, status: 401 },
    );
  }

  const url = new URL(request.url);
  const moduleValues = url.searchParams.getAll("moduleId");
  const accessModeValues = url.searchParams.getAll("accessMode");
  const unsupported = [...url.searchParams.keys()].filter(
    (key) => key !== "accessMode" && key !== "moduleId",
  );
  const moduleId = moduleValues[0]?.trim() ?? null;
  const accessModeValue = accessModeValues[0]?.trim() ?? "READ";
  if (unsupported.length > 0
    || moduleValues.length > 1
    || accessModeValues.length > 1
    || (url.searchParams.has("moduleId") && !moduleId)
    || (!moduleId && url.searchParams.has("accessMode"))
    || !licenseAccessModes.includes(accessModeValue as LicenseAccessMode)) {
    return apiResponse(
      {
        ok: false,
        code: "LICENSE_READ_PARAMETERS_INVALID",
        message: "Use moduleId with an optional READ, INTERNAL_WRITE, or EXTERNAL_EFFECT accessMode.",
      },
      { requestIdentity: identity, status: 400 },
    );
  }

  try {
    const snapshot = await readTenantLicenseSnapshot({
      actorId: actor.actorId,
      tenantId: actor.tenantId,
    });
    if (!snapshot) {
      return apiResponse(
        { ok: false, code: "TENANT_LICENSE_NOT_FOUND", message: "No current tenant license was found." },
        { requestIdentity: identity, status: 404 },
      );
    }
    const decision = moduleId
      ? evaluateLicensedModuleAccess({
        moduleId,
        now: snapshot.observedAt,
        requestedAccess: accessModeValue as LicenseAccessMode,
        snapshot,
        tenantId: actor.tenantId,
      })
      : null;
    return apiResponse(
      {
        ok: true,
        contractVersion: TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION,
        decision,
        snapshot,
      },
      { requestIdentity: identity, cacheControl: "private, no-store" },
    );
  } catch {
    return apiResponse(
      {
        ok: false,
        code: "LICENSE_READBACK_UNAVAILABLE",
        message: "Canonical license readback is unavailable.",
      },
      { requestIdentity: identity, status: 503 },
    );
  }
}
