export const LEAD_COMMERCIAL_CASE_CONTRACT_VERSION = "luzione-lead-commercial-case/v0.1";
export const LEAD_OBJECT_OWNER = "LUZIONE_GROWTH_LEAD";
export const COMMERCIAL_CASE_OBJECT_OWNER = "LUZIONE_COMMERCIAL_CASE";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

export type LeadCreateCommand = {
  commandId: string;
  commandType: "lead.create";
  contractVersion: typeof LEAD_COMMERCIAL_CASE_CONTRACT_VERSION;
  expectedObjectVersion: "ABSENT";
  idempotencyKey: string;
  lead: {
    accountId: string | null;
    assignedOwnerId: string | null;
    contactId: string | null;
    leadSource: string;
    recommendedNextAction: string | null;
    stage: string;
    status: string;
    vertical: string | null;
  };
  leadId: string;
};

export type CommercialCaseCommand = {
  caseId: string;
  commandId: string;
  contractVersion: typeof LEAD_COMMERCIAL_CASE_CONTRACT_VERSION;
  expectedObjectVersion: string;
  idempotencyKey: string;
} & (
  | {
      commandType: "commercial_case.create";
      commercialCase: {
        accountId: string | null;
        accountName: string | null;
        amount: number | null;
        contactName: string | null;
        primaryContactId: string | null;
        sourceLeadId: string;
        sourceLeadVersion: string;
        title: string;
      };
    }
  | { commandType: "commercial_case.update_owner"; owner: string }
  | {
      commandType: "commercial_case.update_next_action";
      nextAction: string;
      nextActionDueAt: string | null;
    }
);

export type LeadCommercialCaseCommand = LeadCreateCommand | CommercialCaseCommand;

export class LeadCommercialCaseContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "LeadCommercialCaseContractError";
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LeadCommercialCaseContractError("INVALID_COMMAND", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new LeadCommercialCaseContractError("INVALID_COMMAND", `${field} must be a non-empty bounded string.`);
  }
  return value.trim();
}

function id(value: unknown, field: string) {
  const parsed = string(value, field, 200);
  if (!ID.test(parsed)) {
    throw new LeadCommercialCaseContractError("INVALID_COMMAND", `${field} must be a stable canonical identifier.`);
  }
  return parsed;
}

function nullableString(value: unknown, field: string, max = 500) {
  if (value === undefined || value === null || value === "") return null;
  return string(value, field, max);
}

function money(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
    throw new LeadCommercialCaseContractError("INVALID_COMMAND", `${field} must be a finite non-negative amount.`);
  }
  return value;
}

function timestamp(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = string(value, field, 100);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new LeadCommercialCaseContractError("INVALID_COMMAND", `${field} must be an ISO timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function base(input: Record<string, unknown>): {
  commandId: string;
  contractVersion: typeof LEAD_COMMERCIAL_CASE_CONTRACT_VERSION;
  expectedObjectVersion: string;
  idempotencyKey: string;
} {
  if (input.contractVersion !== LEAD_COMMERCIAL_CASE_CONTRACT_VERSION) {
    throw new LeadCommercialCaseContractError(
      "UNSUPPORTED_CONTRACT_VERSION",
      `contractVersion must be ${LEAD_COMMERCIAL_CASE_CONTRACT_VERSION}.`,
    );
  }
  for (const forged of ["actor", "actorId", "actorType", "tenant", "tenantId", "authority", "effectClass"]) {
    if (forged in input) {
      throw new LeadCommercialCaseContractError("AUTHORITY_FORGED", `${forged} is derived from authenticated server context.`);
    }
  }
  return {
    commandId: id(input.commandId, "commandId"),
    contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
    expectedObjectVersion: string(input.expectedObjectVersion, "expectedObjectVersion", 300),
    idempotencyKey: id(input.idempotencyKey, "idempotencyKey"),
  };
}

export function parseLeadCommand(value: unknown): LeadCreateCommand {
  const input = object(value, "command");
  const common = base(input);
  if (input.commandType !== "lead.create") {
    throw new LeadCommercialCaseContractError("UNSUPPORTED_COMMAND", "commandType must be lead.create.");
  }
  if (common.expectedObjectVersion !== "ABSENT") {
    throw new LeadCommercialCaseContractError("VERSION_CONFLICT", "lead.create requires expectedObjectVersion ABSENT.", 409);
  }
  const lead = object(input.lead, "lead");
  return {
    ...common,
    commandType: "lead.create",
    expectedObjectVersion: "ABSENT",
    lead: {
      accountId: nullableString(lead.accountId, "lead.accountId", 200),
      assignedOwnerId: nullableString(lead.assignedOwnerId, "lead.assignedOwnerId", 200),
      contactId: nullableString(lead.contactId, "lead.contactId", 200),
      leadSource: string(lead.leadSource, "lead.leadSource", 200),
      recommendedNextAction: nullableString(lead.recommendedNextAction, "lead.recommendedNextAction", 1_000),
      stage: string(lead.stage, "lead.stage", 100),
      status: string(lead.status, "lead.status", 100),
      vertical: nullableString(lead.vertical, "lead.vertical", 200),
    },
    leadId: id(input.leadId, "leadId"),
  };
}

export function parseCommercialCaseCommand(value: unknown): CommercialCaseCommand {
  const input = object(value, "command");
  const common = base(input);
  const caseId = id(input.caseId, "caseId");
  if (input.commandType === "commercial_case.create") {
    if (common.expectedObjectVersion !== "ABSENT") {
      throw new LeadCommercialCaseContractError("VERSION_CONFLICT", "commercial_case.create requires expectedObjectVersion ABSENT.", 409);
    }
    const commercialCase = object(input.commercialCase, "commercialCase");
    return {
      ...common,
      caseId,
      commandType: "commercial_case.create",
      commercialCase: {
        accountId: nullableString(commercialCase.accountId, "commercialCase.accountId", 200),
        accountName: nullableString(commercialCase.accountName, "commercialCase.accountName", 500),
        amount: money(commercialCase.amount, "commercialCase.amount"),
        contactName: nullableString(commercialCase.contactName, "commercialCase.contactName", 500),
        primaryContactId: nullableString(commercialCase.primaryContactId, "commercialCase.primaryContactId", 200),
        sourceLeadId: id(commercialCase.sourceLeadId, "commercialCase.sourceLeadId"),
        sourceLeadVersion: string(commercialCase.sourceLeadVersion, "commercialCase.sourceLeadVersion", 300),
        title: string(commercialCase.title, "commercialCase.title", 500),
      },
    };
  }
  if (input.commandType === "commercial_case.update_owner") {
    return {
      ...common,
      caseId,
      commandType: "commercial_case.update_owner",
      owner: string(input.owner, "owner", 300),
    };
  }
  if (input.commandType === "commercial_case.update_next_action") {
    return {
      ...common,
      caseId,
      commandType: "commercial_case.update_next_action",
      nextAction: string(input.nextAction, "nextAction", 1_000),
      nextActionDueAt: timestamp(input.nextActionDueAt, "nextActionDueAt"),
    };
  }
  throw new LeadCommercialCaseContractError(
    "UNSUPPORTED_COMMAND",
    "Unsupported Commercial Case command for luzione-lead-commercial-case/v0.1.",
  );
}
