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
  dependencyCatalog,
  dependencyGraph,
  PLATFORM_SERVICE_CATALOG_VERSION,
  runbookRegistry,
  serviceCatalog,
} from "@/modules/platform-service-catalog/registry";

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
      serviceCatalog: {
        dependencies: dependencyCatalog,
        dependencyGraph,
        registryVersion: PLATFORM_SERVICE_CATALOG_VERSION,
        runbooks: runbookRegistry,
        services: serviceCatalog,
      },
      platformAreas,
      authority: {
        app: "Human records, queues, actions, documents and approvals",
        api: "Deterministic truth, commands, events, workflow, integration, access, reliability and audit",
        os: "Reasoning, agents, tools, models, memory, simulations and AI governance",
      },
    },
    { requestIdentity: identity },
  );
}
