import {
  OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS,
  OPERATIONS_EVIDENCE_LEDGER_V3_MANIFEST_VERSION,
  OPERATIONS_EVIDENCE_LEDGER_V3_VERSION,
} from "./contracts";
import {
  calculateCapabilityEpochResetDigest,
  calculateG2EffectAuthorityGrantDigest,
  calculateHumanAuthoritySourceBindingDigest,
  calculateIncidentRecoverySourceBindingDigest,
  calculateOperationsEvidenceLedgerV3Digest,
  deriveCapabilityEpochResetV2,
  parseLuzioneOperationsEvidenceLedgerManifestV3,
  parseOperationsEvidenceLedgerV3,
  sealG2EffectAuthorityGrantV2,
  sealHumanAuthoritySourceBindingV1,
  sealIncidentRecoverySourceBindingV1,
  sealOperationsEvidenceLedgerV3,
} from "./sdk";
import { OPS_CORRECTION_02_ASSURANCE, OPS_CORRECTION_02_ADVERSE_PROBES, OPS_LEDGER_V3_SCHEMA_KEYS, REQUIRED_G2_SCOPES_V2 } from "./rules";

export const luzioneOperationsEvidenceLedgerSdkV3 = Object.freeze({
  adverseProbes: OPS_CORRECTION_02_ADVERSE_PROBES,
  assurance: OPS_CORRECTION_02_ASSURANCE,
  auxiliaryVersions: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS,
  calculateCapabilityEpochResetDigest,
  calculateG2EffectAuthorityGrantDigest,
  calculateHumanAuthoritySourceBindingDigest,
  calculateIncidentRecoverySourceBindingDigest,
  calculateLedgerDigest: calculateOperationsEvidenceLedgerV3Digest,
  deriveCapabilityEpochReset: deriveCapabilityEpochResetV2,
  ledgerVersion: OPERATIONS_EVIDENCE_LEDGER_V3_VERSION,
  manifestVersion: OPERATIONS_EVIDENCE_LEDGER_V3_MANIFEST_VERSION,
  parseLedger: parseOperationsEvidenceLedgerV3,
  parseManifest: parseLuzioneOperationsEvidenceLedgerManifestV3,
  requiredG2Scopes: REQUIRED_G2_SCOPES_V2,
  schemaKeys: OPS_LEDGER_V3_SCHEMA_KEYS,
  sealG2Grant: sealG2EffectAuthorityGrantV2,
  sealHumanBinding: sealHumanAuthoritySourceBindingV1,
  sealIncidentRecovery: sealIncidentRecoverySourceBindingV1,
  sealLedger: sealOperationsEvidenceLedgerV3,
});
