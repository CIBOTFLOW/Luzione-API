import crypto from "node:crypto";

export const LEARNING_COMMAND_CONTRACT_VERSION = "learning-command/v1" as const;

export type LearningCommandType =
  | "learning.candidate.promote"
  | "learning.candidate.rollback";

export type LearningCommandDigestInput = {
  candidateVersionId: string;
  commandType: LearningCommandType;
  evaluationReceiptId: string;
  expectedStage: "CANARY" | "DEPLOYED";
  targetStage: "DEPLOYED" | "ROLLED_BACK";
  targetVersion: string;
  tenantId: string;
};

export function learningCommandContentDigest(input: LearningCommandDigestInput) {
  const canonical = [
    LEARNING_COMMAND_CONTRACT_VERSION,
    input.tenantId,
    input.commandType,
    input.candidateVersionId,
    input.evaluationReceiptId,
    input.expectedStage,
    input.targetStage,
    input.targetVersion,
  ].join("|");
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}
