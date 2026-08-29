import assert from "node:assert/strict";
import test from "node:test";

import { controlPlaneOpenApi } from "../openapi";

test("OpenAPI publishes the complete versioned connection and effect surface", () => {
  assert.equal(controlPlaneOpenApi.openapi, "3.1.0");
  for (const path of [
    "/connections",
    "/connections/{connectionId}",
    "/connections/{connectionId}/validate",
    "/connections/{connectionId}/refresh",
    "/connections/{connectionId}/disconnect",
    "/connections/{connectionId}/health",
    "/connections/{connectionId}/sync-runs",
    "/commands",
    "/commands/{commandId}",
    "/models/catalog",
    "/autonomy/petitions",
    "/autonomy/identity/candidates",
    "/approvals/{approvalId}/decisions",
    "/webhooks/{provider}",
  ]) {
    assert.ok(path in controlPlaneOpenApi.paths, `${path} is missing`);
  }
  assert.equal(controlPlaneOpenApi.components.schemas.EffectEnvelope.properties.contractVersion.const, "luzione-authority/v2");
  assert.equal(controlPlaneOpenApi.components.schemas.ModelCatalogResponse.properties.contractVersion.const, "luzione-model-catalog/v1");
  assert.equal(controlPlaneOpenApi.components.schemas.ConstitutionalPetitionRequest.properties.petition.additionalProperties, false);
  assert.equal(controlPlaneOpenApi.components.schemas.IdentityCandidateRequest.properties.candidate.additionalProperties, false);
});
