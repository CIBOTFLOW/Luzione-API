import { readFile } from "node:fs/promises";

import {
  evaluateProductionConvergenceEvidence,
  productionConvergenceEvidenceViolations,
  type ProductionConvergenceEvidenceBundle,
} from "../src/modules/platform-operations/evidence";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: npm run evidence:production -- <evidence.json> [--require-production]");
  const parsed = JSON.parse(await readFile(path, "utf8")) as ProductionConvergenceEvidenceBundle;
  const violations = productionConvergenceEvidenceViolations(parsed);
  if (violations.length) {
    console.error(JSON.stringify({ contractValid: false, violations }));
    process.exitCode = 1;
    return;
  }
  const evaluation = evaluateProductionConvergenceEvidence(parsed);
  console.log(JSON.stringify({ contractValid: true, ...evaluation }));
  if (process.argv.includes("--require-production") && !evaluation.productionReady) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.slice(0, 1_000) : "Evidence validation failed.");
  process.exitCode = 1;
});
