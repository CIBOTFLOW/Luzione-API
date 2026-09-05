export type LuzioneCoreCompatibilityErrorCode =
  | "CORE_AUTHORITY_DENIED"
  | "CORE_DARK_FLAG_REQUIRED"
  | "CORE_EXPIRED"
  | "CORE_FIELD_SET_MISMATCH"
  | "CORE_FINALITY_INVALID"
  | "CORE_REFERENCE_MISMATCH"
  | "CORE_REPLAY_CONFLICT"
  | "CORE_TENANT_MISMATCH"
  | "CORE_VALUE_INVALID"
  | "CORE_WRONG_VERSION";

export class LuzioneCoreCompatibilityError extends Error {
  readonly code: LuzioneCoreCompatibilityErrorCode;

  constructor(code: LuzioneCoreCompatibilityErrorCode, message: string) {
    super(message);
    this.name = "LuzioneCoreCompatibilityError";
    this.code = code;
  }
}
