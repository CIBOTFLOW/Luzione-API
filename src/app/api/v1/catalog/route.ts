import { AUTHORITY_SUBJECT_CONTRACT_VERSION } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { canonicalObjects, platformAreas } from "@/lib/platformCatalog";
import {
  PLATFORM_CONTRACT_REGISTRY_VERSION,
  platformCompatibilityLaw,
  platformContractRegistry,
} from "@/modules/platform-contracts/registry";
import {
  mutationPathFindings,
  SOURCE_OF_TRUTH_REGISTRY_VERSION,
  sourceOfTruthRegistry,
} from "@/modules/platform-contracts/truthRegistry";
import {
  TABLE_OBJECT_REGISTRY_VERSION,
  tableObjectRegistry,
  tableObjectRegistryCoverage,
} from "@/modules/platform-contracts/tableObjectRegistry";
import {
  dependencyCatalog,
  dependencyGraph,
  PLATFORM_SERVICE_CATALOG_VERSION,
  runbookRegistry,
  serviceCatalog,
} from "@/modules/platform-service-catalog/registry";
import {
  PLATFORM_RECOVERY_CONTRACT_VERSION,
  recoveryRegistry,
} from "@/modules/platform-recovery/registry";
import {
  PLATFORM_TELEMETRY_CONTRACT_VERSION,
  telemetryAttributeLaw,
  telemetryMetricRegistry,
} from "@/modules/platform-telemetry/telemetry";
import {
  errorBudgetLaw,
  PLATFORM_SLO_REGISTRY_VERSION,
  sliRegistry,
  sloRegistry,
} from "@/modules/platform-slo/registry";
import {
  PLATFORM_SECURITY_CONTROL_REGISTRY_VERSION,
  securityControlRegistry,
} from "@/modules/platform-security-controls/registry";
import {
  PLATFORM_READINESS_EVIDENCE_VERSION,
  readinessEvidenceLaw,
} from "@/modules/platform-readiness/evidence";
import {
  productionReadinessCertificationLaw,
  PRODUCTION_READINESS_CERTIFICATION_VERSION,
} from "@/modules/platform-readiness/certification";
import {
  API_CONTRACT_RELEASE_COMPONENTS,
  API_CONTRACT_RELEASE_VERSION,
  RELEASE_IDENTITY_CONTRACT_VERSION,
} from "@/modules/production-convergence/releaseIdentity";
import {
  performanceProfileRegistry,
  PLATFORM_PERFORMANCE_PROGRAM_VERSION,
} from "@/modules/platform-performance/program";
import {
  PLATFORM_RELEASE_EVIDENCE_VERSION,
  releaseEvidenceLaw,
} from "@/modules/platform-release/releaseContract";
import {
  PLATFORM_TEST_TAXONOMY_VERSION,
  testOrchestrationLaw,
  testTaxonomySummary,
} from "@/modules/platform-testing/taxonomy";
import {
  causalNavigationLaw,
  PLATFORM_CAUSAL_NAVIGATION_VERSION,
} from "@/modules/platform-causality/navigation";
import {
  crossSystemJourneyCertificationLaw,
  CROSS_SYSTEM_JOURNEY_CERTIFICATION_VERSION,
} from "@/modules/platform-journeys/certification";

export async function GET(request: Request) {
  const identity = createRequestIdentity(request.headers);
  return apiResponse(
    {
      ok: true,
      contractVersion: "1.0",
      contractRegistry: {
        compatibilityLaw: platformCompatibilityLaw,
        contracts: platformContractRegistry,
        registryVersion: PLATFORM_CONTRACT_REGISTRY_VERSION,
      },
      canonicalObjects,
      compatibilityNotices: [
        {
          field: "authority",
          status: "DEPRECATED_AMBIGUOUS",
          replacement: "contractRegistry and sourceOfTruthRegistry",
          reason: "The legacy field mixes presentation, contract and record ownership.",
        },
        {
          field: "canonicalObjects[].owner",
          status: "LEGACY_FUNCTIONAL_LABEL_ONLY",
          replacement: "sourceOfTruthRegistry.entries[].semanticOwner and mutationOwner",
          reason: "Functional workspace labels are not canonical mutation-owner evidence.",
        },
        {
          field: "platformAreas[].status",
          status: "LEGACY_COARSE_MATURITY",
          replacement: "contractRegistry.contracts[].maturity and currentRuntime",
          reason: "The foundation label does not distinguish callable, library, specified or draft contracts.",
        },
      ],
      sourceOfTruthRegistry: {
        entries: sourceOfTruthRegistry,
        mutationPathFindings,
        registryVersion: SOURCE_OF_TRUTH_REGISTRY_VERSION,
      },
      tableObjectRegistry: {
        coverage: tableObjectRegistryCoverage,
        entries: tableObjectRegistry,
        registryVersion: TABLE_OBJECT_REGISTRY_VERSION,
        schemaPath: "contracts/objects/luzione-table-object-registry-v1.schema.json",
      },
      serviceCatalog: {
        dependencies: dependencyCatalog,
        dependencyGraph,
        registryVersion: PLATFORM_SERVICE_CATALOG_VERSION,
        runbooks: runbookRegistry,
        services: serviceCatalog,
      },
      observability: {
        attributeLaw: telemetryAttributeLaw,
        contractVersion: PLATFORM_TELEMETRY_CONTRACT_VERSION,
        metrics: telemetryMetricRegistry,
      },
      recoveryRegistry: {
        contractVersion: PLATFORM_RECOVERY_CONTRACT_VERSION,
        scopes: recoveryRegistry,
      },
      sloRegistry: {
        contractVersion: PLATFORM_SLO_REGISTRY_VERSION,
        errorBudgetLaw,
        slis: sliRegistry,
        slos: sloRegistry,
      },
      securityControls: {
        contractVersion: PLATFORM_SECURITY_CONTROL_REGISTRY_VERSION,
        controls: securityControlRegistry,
      },
      readinessEvidence: {
        contractVersion: PLATFORM_READINESS_EVIDENCE_VERSION,
        law: readinessEvidenceLaw,
        runtimeSurface: "GET /api/v1/healthz",
      },
      productionReadinessCertification: {
        contractVersion: PRODUCTION_READINESS_CERTIFICATION_VERSION,
        law: productionReadinessCertificationLaw,
      },
      performanceProgram: {
        contractVersion: PLATFORM_PERFORMANCE_PROGRAM_VERSION,
        profiles: performanceProfileRegistry,
      },
      releaseEvidence: {
        contractVersion: PLATFORM_RELEASE_EVIDENCE_VERSION,
        law: releaseEvidenceLaw,
      },
      productionConvergenceContract: {
        components: API_CONTRACT_RELEASE_COMPONENTS,
        manifestPath: "contracts/contract-manifest.v0.1.json",
        openApiPath: "contracts/openapi/luzione-api-v0.1.yaml",
        releaseIdentityContractVersion: RELEASE_IDENTITY_CONTRACT_VERSION,
        releaseVersion: API_CONTRACT_RELEASE_VERSION,
        runtimeSurface: "GET /api/v1/release",
      },
      testProgram: {
        contractVersion: PLATFORM_TEST_TAXONOMY_VERSION,
        orchestrationLaw: testOrchestrationLaw,
        summary: testTaxonomySummary(),
      },
      causalNavigation: {
        contractVersion: PLATFORM_CAUSAL_NAVIGATION_VERSION,
        law: causalNavigationLaw,
      },
      crossSystemJourneyCertification: {
        contractVersion: CROSS_SYSTEM_JOURNEY_CERTIFICATION_VERSION,
        law: crossSystemJourneyCertificationLaw,
      },
      platformAreas,
      authority: {
        app: "Human records, queues, actions, documents and approvals",
        api: "Deterministic truth, commands, events, workflow, integration, access, reliability and audit",
        subjectContractVersion: AUTHORITY_SUBJECT_CONTRACT_VERSION,
        os: "Reasoning, agents, tools, models, memory, simulations and AI governance",
      },
    },
    { requestIdentity: identity },
  );
}
