import {
  calculateCompletenessBps,
  calculateDailyCredit,
  calculateUtilizationBps,
  parseLuzioneOperationsEvidenceManifestV1,
  parseOperationsEvidenceDocumentV1,
} from "./consumerSdk";
import {
  OPERATIONS_EVIDENCE_BUNDLE_VERSION,
  OPERATIONS_EVIDENCE_MANIFEST_VERSION,
  OPERATIONS_EVIDENCE_VERSIONS,
  OPS_CORE_COMPOSITION,
  OPS_PACKET_PINS,
} from "./contracts";

/**
 * Generated public binding surface for LuzioneOperationsEvidence/v1.
 * The schema/manifest version map is the generation input; semantic functions
 * remain centralized in consumerSdk.ts so every consumer applies one law.
 */
export const luzioneOperationsEvidenceSdkV1 = Object.freeze({
  bundleVersion: OPERATIONS_EVIDENCE_BUNDLE_VERSION,
  calculateCompletenessBps,
  calculateDailyCredit,
  calculateUtilizationBps,
  coreComposition: OPS_CORE_COMPOSITION,
  manifestVersion: OPERATIONS_EVIDENCE_MANIFEST_VERSION,
  parseDocument: parseOperationsEvidenceDocumentV1,
  parseManifest: parseLuzioneOperationsEvidenceManifestV1,
  sourcePacketPins: OPS_PACKET_PINS,
  supportedContractVersions: Object.freeze(Object.values(OPERATIONS_EVIDENCE_VERSIONS)),
});
