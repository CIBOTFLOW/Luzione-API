import assert from "node:assert/strict";

import { databasePool } from "@/lib/db";
import { readRlsReadiness } from "@/lib/security-posture/readService";
import {
  ACTIVE_DENIAL_PROBES,
  PRODUCTION_CONVERGENCE_TENANT_TABLES,
  a01ReadinessSignature,
} from "@/modules/security-posture/rlsPosture";

const expectedMode = process.env.A01_EXPECTED_POSTURE ?? "PASS";
if (expectedMode !== "PASS" && expectedMode !== "PRODUCTION_DRIFT") {
  throw new Error("A01_EXPECTED_POSTURE must be PASS or PRODUCTION_DRIFT.");
}

async function main() {
  try {
    const result = await readRlsReadiness({ activeProbes: true });
    const signature = a01ReadinessSignature(result);
    assert.equal(result.probes.length, ACTIVE_DENIAL_PROBES.length, "all active denial probes must execute");
    assert.ok(result.probes.every((probe) => probe.denied), "every active denial probe must be permission-denied");
    assert.equal(result.globalExposure.rls_disabled_client_accessible_count, 0);
    assert.equal(result.globalExposure.rls_disabled_client_writable_count, 0);
    assert.equal(result.globalExposure.rls_disabled_table_count, 0);

    if (expectedMode === "PASS") {
      assert.deepEqual(signature, {
        expectedTableCount: 40,
        failedProbeCount: 0,
        legacyServiceRoleTables: [],
        missingRoles: [],
        missingTables: [],
        notForcedTables: [],
        observedTableCount: 40,
        otherViolationCodes: [],
        status: "PASS",
        violationCount: 0,
      });
    } else {
      const missingTable = "order_fulfillment_intents";
      const driftTables = PRODUCTION_CONVERGENCE_TENANT_TABLES
        .filter((table) => table !== missingTable)
        .sort();
      assert.deepEqual(signature, {
        expectedTableCount: 40,
        failedProbeCount: 0,
        legacyServiceRoleTables: driftTables,
        missingRoles: ["luzione_api_runtime", "luzione_provider_worker"],
        missingTables: [missingTable],
        notForcedTables: driftTables,
        observedTableCount: 39,
        otherViolationCodes: [],
        status: "FAIL",
        violationCount: 61,
      });
    }

    console.log(JSON.stringify({
      activeDenialProbes: result.probes.length,
      expectedMode,
      globalExposure: result.globalExposure,
      signature,
      source: result.source,
    }));
  } finally {
    await databasePool().end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
