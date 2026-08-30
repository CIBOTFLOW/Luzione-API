import crypto from "node:crypto";
import { apiResponse, logRequestCompletion, requestId } from "@/lib/api/http";
import { CanonicalActorError, requireCanonicalActor, requireWorkloadCapability } from "@/lib/control-plane/actor";
import { readActiveTenantPolicy } from "@/lib/tenant-policy/readService";
import { evaluateAutonomyPlan } from "@/modules/autonomy/evaluator";
import { AutonomyRequestError, parseAutonomyEvaluationRequest } from "@/modules/autonomy/parser";
import type { VerifiedAuthorityGrant } from "@/modules/autonomy/types";
import { evaluateTenantPolicy } from "@/modules/tenant-policy/evaluator";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 32 * 1024;

export async function POST(request: Request) {
  const startedAt = performance.now();
  const id = requestId(request.headers);
  let status = 200;
  let tenantId: string | undefined;
  try {
    const actor = requireWorkloadCapability(
      await requireCanonicalActor(request.headers),
      "governance.evaluate",
    );
    tenantId = actor.tenantId;
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      throw new AutonomyRequestError("INVALID_REQUEST", "Request body is too large.");
    }
    const plan = parseAutonomyEvaluationRequest(JSON.parse(rawBody));
    const policy = await readActiveTenantPolicy(actor.tenantCode);
    const actorType = actor.principal.principalType.toLowerCase() as "user" | "service" | "agent";
    const actorId = actor.principal.identityId;
    const tenantDecision = evaluateTenantPolicy({ actorType, plan, policy });
    let authorityGrant: VerifiedAuthorityGrant | undefined;
    if (tenantDecision.allowedByPolicy && plan.declaredEffectClass !== "A0" && plan.declaredEffectClass !== "A3" && plan.declaredEffectClass !== "A4") {
      authorityGrant = {
        actionId: plan.declaredEffectClass === "A2" ? plan.actionId : null,
        actionVersion: plan.declaredEffectClass === "A2" ? plan.actionVersion : null,
        approvedBy: `policy:${policy.policyDefinitionId}:v${policy.version}`,
        capability: plan.capability,
        consumed: false,
        effectClassMaximum: plan.declaredEffectClass,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        grantId: crypto.randomUUID(),
        granteeActorId: actorId,
        oneTime: plan.declaredEffectClass === "A2",
        purpose: plan.purpose,
        source: "POLICY_GRANT",
        tenantId: actor.tenantId,
        verification: "CANONICAL_STORE",
      };
    }
    const constitutionalDecision = tenantDecision.allowedByPolicy
      ? evaluateAutonomyPlan(plan, {
          actor: { actorId, actorType, tenantId: actor.tenantId },
          authorityGrant,
          now: new Date().toISOString(),
        })
      : null;
    const allowed = tenantDecision.allowedByPolicy && constitutionalDecision?.decision === "ALLOW";
    const body = {
      ok: true,
      evaluatedOnly: true,
      allowed,
      tenantDecision,
      constitutionalDecision,
      policy: { checksum: policy.checksum, code: policy.code, version: policy.version },
      externalEffectsAuthorized: false,
    };
    logRequestCompletion({ requestId: id, route: "/api/v1/governance/evaluate", status, startedAt, tenantId });
    return apiResponse(body, { requestId: id, status, startedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    status = error instanceof AutonomyRequestError || error instanceof SyntaxError
      ? 400
      : error instanceof CanonicalActorError
        ? error.status
      : /authentication|tenant|actor/i.test(message)
        ? 401
        : 503;
    logRequestCompletion({ requestId: id, route: "/api/v1/governance/evaluate", status, startedAt, tenantId });
    return apiResponse({
      ok: false,
      code: error instanceof AutonomyRequestError ? error.code : "POLICY_EVALUATION_FAILED",
      message: error instanceof Error ? error.message : "Policy evaluation failed closed.",
      externalEffectsAuthorized: false,
    }, { requestId: id, status, startedAt });
  }
}
