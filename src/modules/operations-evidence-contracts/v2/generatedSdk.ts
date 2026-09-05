import {
  OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS,
  OPERATIONS_EVIDENCE_LEDGER_MANIFEST_VERSION,
  OPERATIONS_EVIDENCE_LEDGER_VERSION,
} from "./contracts";
import {
  calculateContentDigest,
  calculateLedgerDigest,
  calculateRecordSetDigest,
  parseLuzioneOperationsEvidenceLedgerManifestV2,
  parseOperationsEvidenceLedgerV2,
  sealOperationsEvidenceLedgerV2,
} from "./sdk";
import {
  HARD_ZERO_METRIC_KEYS,
  OPS_CORRECTION_ASSURANCE,
  OPS_LEDGER_LIMITS,
  OPS_LEDGER_SCHEMA_KEYS,
  REQUIRED_PROOF_ENTRY_G2_EFFECTS,
} from "./rules";

export const luzioneOperationsEvidenceLedgerSdkV2 = Object.freeze({
  assurance: OPS_CORRECTION_ASSURANCE,
  auxiliaryVersions: OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS,
  calculateContentDigest,
  calculateLedgerDigest,
  calculateRecordSetDigest,
  hardZeroMetricKeys: HARD_ZERO_METRIC_KEYS,
  ledgerVersion: OPERATIONS_EVIDENCE_LEDGER_VERSION,
  limits: OPS_LEDGER_LIMITS,
  manifestVersion: OPERATIONS_EVIDENCE_LEDGER_MANIFEST_VERSION,
  parseLedger: parseOperationsEvidenceLedgerV2,
  parseManifest: parseLuzioneOperationsEvidenceLedgerManifestV2,
  requiredProofEntryG2Effects: REQUIRED_PROOF_ENTRY_G2_EFFECTS,
  schemaKeys: OPS_LEDGER_SCHEMA_KEYS,
  sealLedger: sealOperationsEvidenceLedgerV2,
});
