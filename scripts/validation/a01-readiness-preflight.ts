import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import { databasePool } from "@/lib/db";
import { readRlsReadiness } from "@/lib/security-posture/readService";
import {
  ACTIVE_DENIAL_PROBES,
  EXPECTED_RLS_TABLES,
  PRODUCTION_CONVERGENCE_TENANT_TABLES,
  a01ReadinessSignature,
} from "@/modules/security-posture/rlsPosture";

const expectedMode = process.env.A01_EXPECTED_POSTURE ?? "PASS";
if (expectedMode !== "PASS" && expectedMode !== "PRODUCTION_DRIFT") {
  throw new Error("A01_EXPECTED_POSTURE must be PASS or PRODUCTION_DRIFT.");
}

const currentProductionMissingTables = Object.freeze([
  "order_fulfillment_intents",
  "sultan_agent_policy_envelopes",
  "sultan_agent_command_reservations",
  "sultan_agent_internal_actions",
  "sultan_stage5_idempotency_conflicts",
  "sultan_canonical_readback_receipts",
  "sultan_api_admission_receipts",
  "sultan_api_admission_evidence_refs",
  "sultan_outcome_observations",
]);

async function main() {
  try {
    assert.equal(EXPECTED_RLS_TABLES.length, 48, "A01 proof must remain bound to the current 48-relation contract");
    assert.equal(PRODUCTION_CONVERGENCE_TENANT_TABLES.length, 38);
    const result = await readRlsReadiness({ activeProbes: expectedMode === "PASS" });
    const signature = a01ReadinessSignature(result);
    if (expectedMode === "PASS") {
      assert.equal(result.probes.length, ACTIVE_DENIAL_PROBES.length, "all active denial probes must execute");
      assert.ok(result.probes.every((probe) => probe.denied), "every active denial probe must be permission-denied");
    } else {
      assert.equal(result.probes.length, 0, "the exact public health signature does not run active probes");
    }
    assert.equal(result.globalExposure.rls_disabled_client_accessible_count, 0);
    assert.equal(result.globalExposure.rls_disabled_client_writable_count, 0);
    assert.equal(result.globalExposure.rls_disabled_table_count, 0);

    if (expectedMode === "PASS") {
      assert.deepEqual(signature, {
        expectedTableCount: 48,
        failedProbeCount: 0,
        legacyServiceRoleTables: [],
        missingRoles: [],
        missingTables: [],
        notForcedTables: [],
        observedTableCount: 48,
        otherViolationCodes: [],
        status: "PASS",
        violationCount: 0,
      });
    } else {
      const missingTables = [...currentProductionMissingTables].sort();
      const driftTables = PRODUCTION_CONVERGENCE_TENANT_TABLES
        .filter((table) => !currentProductionMissingTables.includes(table))
        .sort();
      assert.equal(driftTables.length, 29);
      assert.deepEqual(signature, {
        expectedTableCount: 48,
        failedProbeCount: 0,
        legacyServiceRoleTables: driftTables,
        missingRoles: ["luzione_api_runtime", "luzione_provider_worker"],
        missingTables,
        notForcedTables: driftTables,
        observedTableCount: 39,
        otherViolationCodes: [],
        status: "FAIL",
        violationCount: 69,
      });
    }

    const evidence = {
      activeDenialProbes: result.probes.length,
      expectedMode,
      globalExposure: result.globalExposure,
      relationContract: "A01_CURRENT_48_RELATION_TRUTH",
      signature,
      source: result.source,
    };
    if (process.env.A01_EVIDENCE_PATH) {
      writeFileSync(process.env.A01_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    }
    console.log(JSON.stringify(evidence));
  } finally {
    await databasePool().end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
