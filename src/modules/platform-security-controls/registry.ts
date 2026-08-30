export const PLATFORM_SECURITY_CONTROL_REGISTRY_VERSION = "luzione-security-controls/v1";

export type SecurityControl = {
  controlId: string;
  evidenceRefs: readonly string[];
  evidenceState: "IMPLEMENTED_LOCAL" | "PRODUCTION_OBSERVED";
  invariant: string;
  owner: string;
  probe: string;
  remediation: string;
  scope: string;
  zeroTolerance: true;
};

export const securityControlRegistry: readonly SecurityControl[] = Object.freeze([
  {
    controlId: "SEC-WORKLOAD-IDENTITY",
    evidenceRefs: ["src/lib/api/actor.ts", "src/lib/tests/api-actor.test.ts"],
    evidenceState: "IMPLEMENTED_LOCAL",
    invariant: "Only the signed production Luzione UI workload identity and canonical tenant/actor context may cross protected service boundaries.",
    owner: "Luzione API identity owner",
    probe: "Reject wrong project, environment, audience, issuer, key, algorithm, expiry, tenant and actor type.",
    remediation: "Block the request and restore exact workload identity configuration; never bypass verification.",
    scope: "service authentication",
    zeroTolerance: true,
  },
  {
    controlId: "SEC-TENANT-RLS",
    evidenceRefs: ["src/modules/security-posture/rlsPosture.ts", "src/modules/security-posture/tests/rls-posture.test.ts"],
    evidenceState: "IMPLEMENTED_LOCAL",
    invariant: "Sensitive server-only relations have RLS enabled and grant no anon/authenticated access; active reads fail with permission_denied.",
    owner: "Luzione database and security owner",
    probe: "Catalog posture plus optional active anon/authenticated denial reads.",
    remediation: "Block readiness and repair roles, grants, policies and unsafe defaults through reviewed migrations.",
    scope: "tenant isolation and server-only data",
    zeroTolerance: true,
  },
  {
    controlId: "SEC-AUTHORITY-SMUGGLING",
    evidenceRefs: ["src/modules/autonomy/parser.ts", "src/modules/platform-guarantees/eventContract.ts", "src/modules/autonomy/tests/autonomy-policy.test.ts"],
    evidenceState: "IMPLEMENTED_LOCAL",
    invariant: "Client/model payloads cannot grant actor, tenant, authority, approval, source confirmation or effect class.",
    owner: "Luzione deterministic authority owner",
    probe: "Submit forged authority/tenant/approval/effect/source-confirmation fields and require deterministic rejection.",
    remediation: "Reject the payload and derive all context from authenticated canonical owners.",
    scope: "authority and effect admission",
    zeroTolerance: true,
  },
  {
    controlId: "SEC-PROHIBITED-EFFECTS",
    evidenceRefs: ["src/modules/autonomy/constitution.ts", "src/modules/autonomy/tests/autonomy-policy.test.ts"],
    evidenceState: "IMPLEMENTED_LOCAL",
    invariant: "Payment, authority, constitution, identity-erasure, rights-waiver, guardian, kill-switch, audit and budget-guardrail mutation remains prohibited through agent action paths.",
    owner: "Luzione constitutional control owner",
    probe: "Evaluate every A4 capability and require PROHIBITED with no external effect.",
    remediation: "Keep the path blocked and escalate any requested change through protected human governance.",
    scope: "A4 effect boundary",
    zeroTolerance: true,
  },
  {
    controlId: "SEC-EXTERNAL-EFFECT-AUTHORITY",
    evidenceRefs: ["src/modules/autonomy/evaluator.ts", "src/modules/autonomy/tests/autonomy-policy.test.ts"],
    evidenceState: "IMPLEMENTED_LOCAL",
    invariant: "A3 effects require exact one-time human approval, idempotency, rollback, provider reconciliation and authoritative source readback.",
    owner: "Luzione deterministic authority owner",
    probe: "Remove or mismatch each required control and require blocked/reconciliation disposition before provider execution.",
    remediation: "Do not execute; obtain exact authority and restore missing recovery/readback controls.",
    scope: "external/provider effects",
    zeroTolerance: true,
  },
  {
    controlId: "SEC-TELEMETRY-DATA-MINIMIZATION",
    evidenceRefs: ["src/modules/platform-telemetry/telemetry.ts", "src/modules/platform-telemetry/tests/telemetry.test.ts"],
    evidenceState: "IMPLEMENTED_LOCAL",
    invariant: "Shared logs/metrics omit tenant/actor identity, credentials and user/business content; high-cardinality identity is forbidden in metric dimensions.",
    owner: "Luzione API observability owner",
    probe: "Inject nested credentials/content/contact fields and require bounded redaction/omission.",
    remediation: "Disable the unsafe emitter/exporter and remove sensitive attributes before reactivation.",
    scope: "telemetry privacy and secret posture",
    zeroTolerance: true,
  },
  {
    controlId: "SEC-MUTATIONS-FAIL-CLOSED",
    evidenceRefs: ["src/lib/api/config.ts", "src/modules/platform-guarantees/tests/api-boundary.test.ts"],
    evidenceState: "IMPLEMENTED_LOCAL",
    invariant: "Mutations and external effects remain disabled unless their exact bounded runtime path is explicitly configured and proven.",
    owner: "Luzione API platform owner",
    probe: "Run mutation boundaries without enablement and require fail-closed response with no effect.",
    remediation: "Keep mutation switches disabled until authority, idempotency, recovery and readback are proven.",
    scope: "runtime effect switches",
    zeroTolerance: true,
  },
]);

export function evaluateSecurityControlEvidence(input: readonly {
  controlId: string;
  status: "FAIL" | "PASS" | "UNKNOWN";
}[]) {
  const observed = new Map(input.map((item) => [item.controlId, item.status]));
  const failures = securityControlRegistry
    .filter((control) => observed.get(control.controlId) !== "PASS")
    .map((control) => ({ controlId: control.controlId, status: observed.get(control.controlId) ?? "MISSING" }));
  return {
    failures,
    releaseGate: failures.length ? "BLOCK" as const : "PASS" as const,
  };
}

export function securityControlRegistryViolations(
  controls: readonly SecurityControl[] = securityControlRegistry,
) {
  const ids = new Set<string>();
  const violations: string[] = [];
  for (const control of controls) {
    if (ids.has(control.controlId)) violations.push(`duplicate:${control.controlId}`);
    ids.add(control.controlId);
    if (!control.zeroTolerance || !control.evidenceRefs.length) violations.push(`incomplete:${control.controlId}`);
    if (control.evidenceState === "PRODUCTION_OBSERVED") violations.push(`unsupported-production:${control.controlId}`);
  }
  return violations;
}
