export const controlPlaneOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Luzione Control Plane API",
    version: "1.0.0",
    description: "Tenant-isolated connection, authority, approval, command, and webhook contracts. Provider execution remains separately gated.",
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
