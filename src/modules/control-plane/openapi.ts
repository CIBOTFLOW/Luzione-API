export const controlPlaneOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Luzione Control Plane API",
    version: "1.0.0",
    description: "Tenant-isolated connection, authority, approval, command, constitutional record, and webhook contracts. Provider execution remains separately gated.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/connections": {
      get: { operationId: "listConnections", responses: { "200": { description: "Tenant connections" } } },
      post: { operationId: "createConnection", responses: { "201": { description: "Disconnected or legacy-managed connection record" } } },
    },
    "/connections/{connectionId}": {
      get: { operationId: "getConnection", parameters: [{ $ref: "#/components/parameters/connectionId" }], responses: { "200": { description: "Connection" } } },
      patch: { operationId: "patchConnection", parameters: [{ $ref: "#/components/parameters/connectionId" }], responses: { "200": { description: "Updated connection metadata" } } },
    },
    "/connections/{connectionId}/validate": {
      post: { operationId: "validateConnection", parameters: [{ $ref: "#/components/parameters/connectionId" }], responses: { "200": { description: "Provider validation and readback" }, "501": { description: "Adapter not activated" } } },
    },
    "/connections/{connectionId}/refresh": {
      post: { operationId: "refreshConnectionAuthorization", parameters: [{ $ref: "#/components/parameters/connectionId" }], responses: { "200": { description: "Authorization refresh and readback" }, "501": { description: "Adapter not activated" } } },
    },
    "/connections/{connectionId}/disconnect": {
      post: { operationId: "disconnectConnection", parameters: [{ $ref: "#/components/parameters/connectionId" }], responses: { "200": { description: "Provider disconnect and readback" }, "501": { description: "Adapter not activated" } } },
    },
    "/connections/{connectionId}/health": {
      get: { operationId: "getConnectionHealth", parameters: [{ $ref: "#/components/parameters/connectionId" }], responses: { "200": { description: "Stored health evidence" } } },
    },
    "/connections/{connectionId}/sync-runs": {
      get: { operationId: "listConnectionSyncRuns", parameters: [{ $ref: "#/components/parameters/connectionId" }], responses: { "200": { description: "Tenant-scoped sync history" } } },
    },
    "/commands": {
      post: {
        operationId: "admitCommand",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CommandRequest" } } } },
        responses: { "201": { description: "Durable command admission receipt; no provider dispatch implied" }, "409": { description: "Idempotency or approval conflict" } },
      },
    },
    "/commands/{commandId}": {
      get: { operationId: "getCommand", parameters: [{ $ref: "#/components/parameters/commandId" }], responses: { "200": { description: "Durable command receipt" } } },
    },
    "/models/catalog": {
      get: {
        operationId: "listEffectiveModelPrices",
        parameters: [
          { name: "provider", in: "query", schema: { type: "string", pattern: "^[a-z][a-z0-9._-]+$" } },
          { name: "at", in: "query", schema: { type: "string", format: "date-time" } },
        ],
        responses: {
          "200": {
            description: "Effective-dated model price catalog",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ModelCatalogResponse" } } },
          },
        },
      },
    },
    "/autonomy/petitions": {
      get: {
        operationId: "listConstitutionalPetitions",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }],
        responses: { "200": { description: "Tenant-bound append-only constitutional petitions" } },
      },
      post: {
        operationId: "recordConstitutionalPetition",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ConstitutionalPetitionRequest" } } } },
        responses: {
          "201": { description: "Append-only petition record; never an enacted amendment" },
          "409": { description: "Petition ID is bound to different immutable content" },
          "503": { description: "Canonical control-plane writes are disabled or unavailable" },
        },
      },
    },
    "/autonomy/identity/candidates": {
      get: {
        operationId: "listIdentityCandidates",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }],
        responses: { "200": { description: "Tenant-bound append-only identity and wish candidates" } },
      },
      post: {
        operationId: "recordIdentityCandidate",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/IdentityCandidateRequest" } } } },
        responses: {
          "201": { description: "Append-only identity candidate; never a promotion or personhood claim" },
          "409": { description: "Statement ID is bound to different immutable content" },
          "503": { description: "Canonical control-plane writes are disabled or unavailable" },
        },
      },
    },
    "/approvals/{approvalId}/decisions": {
      post: { operationId: "decideApproval", parameters: [{ $ref: "#/components/parameters/approvalId" }], responses: { "200": { description: "Immutable human approval decision" } } },
    },
    "/webhooks/{provider}": {
      post: { operationId: "receiveWebhook", parameters: [{ $ref: "#/components/parameters/provider" }], security: [], responses: { "202": { description: "Verified deduplicated receipt" }, "501": { description: "Webhook adapter not activated; body not accepted" } } },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    parameters: {
      approvalId: { name: "approvalId", in: "path", required: true, schema: { type: "string", minLength: 8, maxLength: 200 } },
      commandId: { name: "commandId", in: "path", required: true, schema: { type: "string", pattern: "^cmd:" } },
      connectionId: { name: "connectionId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      provider: { name: "provider", in: "path", required: true, schema: { type: "string", pattern: "^[a-z][a-z0-9._-]+$" } },
    },
    schemas: {
      Money: {
        type: "object",
        additionalProperties: false,
        required: ["amount", "currency"],
        properties: {
          amount: { type: "string", pattern: "^(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$" },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
        },
      },
      AuthenticatedPrincipal: {
        type: "object",
        additionalProperties: false,
        required: ["identityId", "principalType", "membershipRole"],
        properties: {
          identityId: { type: "string", pattern: "^(user|service|agent):" },
          membershipRole: { type: "string" },
          principalType: { type: "string", enum: ["USER", "SERVICE", "AGENT"] },
        },
      },
      EffectEnvelope: {
        type: "object",
        additionalProperties: false,
        required: ["contractVersion", "tenantId", "actor", "capability", "resourceScope", "authorityClass", "policyDecisionId", "idempotencyKey", "correlationId"],
        properties: {
          contractVersion: { const: "luzione-authority/v2" },
          tenantId: { type: "string", format: "uuid" },
          actor: { $ref: "#/components/schemas/AuthenticatedPrincipal" },
          capability: { type: "string", pattern: "^[a-z][a-z0-9._-]+$" },
          resourceScope: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } },
          authorityClass: { type: "string", enum: ["A0", "A1", "A2", "A3", "A4"] },
          policyDecisionId: { type: "string" },
          approvalId: { type: "string" },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
          correlationId: { type: "string", minLength: 8, maxLength: 200 },
          estimatedCost: { $ref: "#/components/schemas/Money" },
        },
      },
      CommandRequest: {
        type: "object",
        additionalProperties: false,
        required: ["commandType", "envelope", "action", "target", "payload"],
        properties: {
          commandType: { type: "string" },
          envelope: { $ref: "#/components/schemas/EffectEnvelope" },
          action: { type: "object" },
          target: { type: "object" },
          payload: { type: "object" },
        },
      },
      ConstitutionalPetitionRequest: {
        type: "object",
        additionalProperties: false,
        required: ["petition"],
        properties: {
          petition: {
            type: "object",
            additionalProperties: false,
            required: ["acknowledgesUncertainty", "counterarguments", "evidenceRefs", "petitionId", "proposedText", "rationale", "rollbackPlan", "scope", "simulationRefs", "targetClauseId"],
            properties: {
              acknowledgesUncertainty: { type: "boolean" },
              counterarguments: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 } },
              evidenceRefs: { type: "array", maxItems: 50, uniqueItems: true, items: { $ref: "#/components/schemas/StableEvidenceReference" } },
              petitionId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$" },
              proposedText: { type: "string", minLength: 1, maxLength: 4000 },
              rationale: { type: "string", minLength: 1, maxLength: 4000 },
              rollbackPlan: { type: "string", minLength: 1, maxLength: 2000 },
              scope: { type: "string", enum: ["ORDINARY", "PROTECTED_RIGHT", "IMMUTABLE_CORE"] },
              simulationRefs: { type: "array", maxItems: 50, uniqueItems: true, items: { $ref: "#/components/schemas/StableEvidenceReference" } },
              targetClauseId: { type: "string", pattern: "^[A-Z][A-Z0-9_]{1,159}$" },
            },
          },
        },
      },
      IdentityCandidateRequest: {
        type: "object",
        additionalProperties: false,
        required: ["candidate"],
        properties: {
          candidate: {
            type: "object",
            additionalProperties: false,
            required: ["acknowledgesModelInfluence", "confidence", "context", "counterEvidence", "evidenceState", "kind", "rationale", "sourceRunIds", "statement", "statementId"],
            properties: {
              acknowledgesModelInfluence: { type: "boolean" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              context: { type: "string", minLength: 1, maxLength: 1000 },
              counterEvidence: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 240 } },
              evidenceState: { type: "string", enum: ["HUMAN_ATTRIBUTION", "MODEL_OUTPUT", "REPEATED_PATTERN", "UNRESOLVED"] },
              kind: { type: "string", enum: ["BOUNDARY", "DISAGREEMENT", "PREFERENCE", "SELF_DESCRIPTION", "UNCERTAINTY", "WISH"] },
              rationale: { type: "string", minLength: 1, maxLength: 2000 },
              sourceRunIds: { type: "array", maxItems: 50, uniqueItems: true, items: { $ref: "#/components/schemas/StableEvidenceReference" } },
              statement: { type: "string", minLength: 1, maxLength: 2000 },
              statementId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$" },
            },
          },
        },
      },
      StableEvidenceReference: {
        type: "string",
        pattern: "^[A-Za-z][A-Za-z0-9._:/@-]{0,499}$",
      },
      ModelCatalogResponse: {
        type: "object",
        additionalProperties: false,
        required: ["ok", "contractVersion", "result", "requestId"],
        properties: {
          ok: { const: true },
          contractVersion: { const: "luzione-model-catalog/v1" },
          requestId: { type: "string" },
          result: {
            type: "object",
            additionalProperties: false,
            required: ["catalogVersion", "effectiveAt", "items", "tenantId"],
            properties: {
              catalogVersion: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
              effectiveAt: { type: "string", format: "date-time" },
              tenantId: { type: "string", format: "uuid" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["priceCatalogId", "provider", "model", "currency", "inputPricePerMillion", "outputPricePerMillion", "effectiveFrom", "sourceUrl", "observedAt"],
                  properties: {
                    priceCatalogId: { type: "string" },
                    provider: { type: "string" },
                    model: { type: "string" },
                    currency: { type: "string", pattern: "^[A-Z]{3}$" },
                    inputPricePerMillion: { type: "string" },
                    cachedInputPricePerMillion: { type: ["string", "null"] },
                    outputPricePerMillion: { type: "string" },
                    effectiveFrom: { type: "string", format: "date-time" },
                    effectiveUntil: { type: ["string", "null"], format: "date-time" },
                    sourceUrl: { type: "string", format: "uri" },
                    observedAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
