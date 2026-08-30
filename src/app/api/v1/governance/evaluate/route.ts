import crypto from "node:crypto";
import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity, logRequestCompletion } from "@/lib/api/http";
import { readActiveTenantPolicy } from "@/lib/tenant-policy/readService";
import { evaluateAutonomyPlan } from "@/modules/autonomy/evaluator";
import { AutonomyRequestError, parseAutonomyEvaluationRequest } from "@/modules/autonomy/parser";
import type { VerifiedAuthorityGrant } from "@/modules/autonomy/types";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { evaluateTenantPolicy } from "@/modules/tenant-policy/evaluator";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 32 * 1024;

export async function POST(request: Request) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
  try {
    const actor = await requireServiceActor(request.headers);
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "governance.evaluate",
      purpose: "evaluate-tenant-policy-and-constitution",
    });
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      throw new AutonomyRequestError("INVALID_REQUEST", "Request body is too large.");
    }
    const plan = parseAutonomyEvaluationRequest(JSON.parse(rawBody));
    const policy = await readActiveTenantPolicy(actor.tenantId);
    const tenantDecision = evaluateTenantPolicy({ actorType: actor.actorType, plan, policy });
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
        granteeActorId: actor.actorId,
        oneTime: plan.declaredEffectClass === "A2",
        purpose: plan.purpose,
        source: "POLICY_GRANT",
        tenantId: actor.tenantId,
        verification: "CANONICAL_STORE",
      };
    }
    const constitutionalDecision = tenantDecision.allowedByPolicy
      ? evaluateAutonomyPlan(plan, {
          actor: { actorId: actor.actorId, actorType: actor.actorType, tenantId: actor.tenantId },
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
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: "/api/v1/governance/evaluate", status, startedAt });
    return apiResponse(body, { requestIdentity: identity, status, startedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    status = error instanceof AutonomyRequestError || error instanceof SyntaxError
      ? 400
      : /authentication|tenant|actor/i.test(message)
        ? 401
        : 503;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: "/api/v1/governance/evaluate", status, startedAt });
    return apiResponse({
      ok: false,
      code: error instanceof AutonomyRequestError ? error.code : "POLICY_EVALUATION_FAILED",
      message: error instanceof Error ? error.message : "Policy evaluation failed closed.",
      externalEffectsAuthorized: false,
    }, { requestIdentity: identity, status, startedAt });
  }
}
