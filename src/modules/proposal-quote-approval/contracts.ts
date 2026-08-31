export const PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION = "luzione-proposal-quote-approval/v0.1";
export const QUOTE_OBJECT_OWNER = "LUZIONE_COMMERCE_QUOTE";
export const PROPOSAL_REVIEW_OBJECT_OWNER = "LUZIONE_COMMERCIAL_CASE_PROPOSAL_REVIEW";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const CURRENCY = /^[A-Z]{3}$/;

export type QuoteLineInput = {
  description: string;
  lineNumber: number;
  quantity: number;
  sku: string | null;
  unitCostCents: number;
  unitPriceCents: number;
};

type CommandBase = {
  commandId: string;
  contractVersion: typeof PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION;
  expectedObjectVersion: string;
  idempotencyKey: string;
};

export type QuoteCreateCommand = CommandBase & {
  commandType: "quote.create";
  expectedObjectVersion: "ABSENT";
  quote: {
    commercialCaseId: string;
    currency: string;
    customerId: string | null;
    customerName: string;
    lines: QuoteLineInput[];
  };
  quoteId: string;
};

export type QuoteApprovalCommand = CommandBase & {
  commandType: "quote.margin_approval.decide";
  decision: "approved" | "rejected";
  expectedEconomicsVersionId: string;
  quoteId: string;
  rationale: string;
};

export type ProposalFinding = {
  evidenceRef: string;
  findingKey: string;
  resolutionAction: string;
  severity: "info" | "warning" | "blocker";
  status: "open" | "resolved";
  summary: string;
};

export type ProposalReviewCommand = CommandBase & {
  caseId: string;
  commandType: "proposal.review.decide";
  decision: "approved" | "changes_requested" | "rejected";
  expectedProposalDocumentVersionId: string;
  findings: ProposalFinding[];
  reviewerNotes: string;
  typedConfirmation: string | null;
};

export class ProposalQuoteApprovalContractError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "ProposalQuoteApprovalContractError";
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProposalQuoteApprovalContractError("INVALID_COMMAND", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max = 1_000) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new ProposalQuoteApprovalContractError("INVALID_COMMAND", `${field} must be a non-empty bounded string.`);
  }
  return value.trim();
}

function id(value: unknown, field: string) {
  const result = text(value, field, 200);
  if (!ID.test(result)) throw new ProposalQuoteApprovalContractError("INVALID_COMMAND", `${field} must be a stable canonical identifier.`);
  return result;
}

function nullableText(value: unknown, field: string, max = 500) {
  if (value === null || value === undefined || value === "") return null;
  return text(value, field, max);
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > 1_000_000) {
    throw new ProposalQuoteApprovalContractError("INVALID_MONEY", `${field} must be a positive safe integer.`);
  }
  return Number(value);
}

function cents(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ProposalQuoteApprovalContractError("INVALID_MONEY", `${field} must be non-negative safe integer cents.`);
  }
  return Number(value);
}

function base(input: Record<string, unknown>) {
  if (input.contractVersion !== PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION) {
    throw new ProposalQuoteApprovalContractError("UNSUPPORTED_CONTRACT_VERSION", `contractVersion must be ${PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION}.`);
  }
  for (const forged of ["actor", "actorId", "actorType", "tenant", "tenantId", "roles", "capabilities", "authority", "effectClass"]) {
    if (forged in input) throw new ProposalQuoteApprovalContractError("AUTHORITY_FORGED", `${forged} is derived from authenticated server context.`);
  }
  return {
    commandId: id(input.commandId, "commandId"),
    contractVersion: PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION,
    expectedObjectVersion: text(input.expectedObjectVersion, "expectedObjectVersion", 300),
    idempotencyKey: id(input.idempotencyKey, "idempotencyKey"),
  } as const;
}

export function parseQuoteCreateCommand(value: unknown): QuoteCreateCommand {
  const input = object(value, "command");
  const common = base(input);
  if (input.commandType !== "quote.create") throw new ProposalQuoteApprovalContractError("UNSUPPORTED_COMMAND", "commandType must be quote.create.");
  if (common.expectedObjectVersion !== "ABSENT") throw new ProposalQuoteApprovalContractError("VERSION_CONFLICT", "quote.create requires expectedObjectVersion ABSENT.", 409);
  const quote = object(input.quote, "quote");
  const currency = text(quote.currency, "quote.currency", 3);
  if (!CURRENCY.test(currency)) throw new ProposalQuoteApprovalContractError("INVALID_CURRENCY", "quote.currency must be exactly three uppercase ASCII letters.");
  if (!Array.isArray(quote.lines) || quote.lines.length < 1 || quote.lines.length > 200) {
    throw new ProposalQuoteApprovalContractError("INVALID_COMMAND", "quote.lines must contain between 1 and 200 lines.");
  }
  const seen = new Set<number>();
  const lines = quote.lines.map((raw, index) => {
    const line = object(raw, `quote.lines[${index}]`);
    const lineNumber = positiveInteger(line.lineNumber, `quote.lines[${index}].lineNumber`);
    if (seen.has(lineNumber)) throw new ProposalQuoteApprovalContractError("INVALID_COMMAND", "Quote line numbers must be unique.");
    seen.add(lineNumber);
    const quantity = positiveInteger(line.quantity, `quote.lines[${index}].quantity`);
    const unitPriceCents = cents(line.unitPriceCents, `quote.lines[${index}].unitPriceCents`);
    const unitCostCents = cents(line.unitCostCents, `quote.lines[${index}].unitCostCents`);
    if (!Number.isSafeInteger(quantity * unitPriceCents) || !Number.isSafeInteger(quantity * unitCostCents)) {
      throw new ProposalQuoteApprovalContractError("INVALID_MONEY", "Quote line totals exceed safe integer cents.");
    }
    return {
      description: text(line.description, `quote.lines[${index}].description`, 1_000),
      lineNumber,
      quantity,
      sku: nullableText(line.sku, `quote.lines[${index}].sku`, 200),
      unitCostCents,
      unitPriceCents,
    };
  }).sort((left, right) => left.lineNumber - right.lineNumber);
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
  const cost = lines.reduce((sum, line) => sum + line.quantity * line.unitCostCents, 0);
  if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(cost)) throw new ProposalQuoteApprovalContractError("INVALID_MONEY", "Quote totals exceed safe integer cents.");
  return {
    ...common,
    commandType: "quote.create",
    expectedObjectVersion: "ABSENT",
    quote: {
      commercialCaseId: id(quote.commercialCaseId, "quote.commercialCaseId"),
      currency,
      customerId: nullableText(quote.customerId, "quote.customerId", 200),
      customerName: text(quote.customerName, "quote.customerName", 500),
      lines,
    },
    quoteId: id(input.quoteId, "quoteId"),
  };
}

export function parseQuoteApprovalCommand(value: unknown): QuoteApprovalCommand {
  const input = object(value, "command");
  const common = base(input);
  if (input.commandType !== "quote.margin_approval.decide") throw new ProposalQuoteApprovalContractError("UNSUPPORTED_COMMAND", "commandType must be quote.margin_approval.decide.");
  if (input.decision !== "approved" && input.decision !== "rejected") throw new ProposalQuoteApprovalContractError("INVALID_COMMAND", "decision must be approved or rejected.");
  return { ...common, commandType: "quote.margin_approval.decide", decision: input.decision, expectedEconomicsVersionId: id(input.expectedEconomicsVersionId, "expectedEconomicsVersionId"), quoteId: id(input.quoteId, "quoteId"), rationale: text(input.rationale, "rationale", 1_000) };
}

function parseFinding(value: unknown, index: number): ProposalFinding {
  const input = object(value, `findings[${index}]`);
  if (!["info", "warning", "blocker"].includes(String(input.severity)) || !["open", "resolved"].includes(String(input.status))) {
    throw new ProposalQuoteApprovalContractError("INVALID_COMMAND", `findings[${index}] has an invalid severity or status.`);
  }
  return {
    evidenceRef: text(input.evidenceRef, `findings[${index}].evidenceRef`, 500),
    findingKey: id(input.findingKey, `findings[${index}].findingKey`),
    resolutionAction: text(input.resolutionAction, `findings[${index}].resolutionAction`, 1_000),
    severity: input.severity as ProposalFinding["severity"],
    status: input.status as ProposalFinding["status"],
    summary: text(input.summary, `findings[${index}].summary`, 1_000),
  };
}

export function parseProposalReviewCommand(value: unknown): ProposalReviewCommand {
  const input = object(value, "command");
  const common = base(input);
  if (input.commandType !== "proposal.review.decide") throw new ProposalQuoteApprovalContractError("UNSUPPORTED_COMMAND", "commandType must be proposal.review.decide.");
  if (!["approved", "changes_requested", "rejected"].includes(String(input.decision))) throw new ProposalQuoteApprovalContractError("INVALID_COMMAND", "decision is invalid.");
  const findings = input.findings === undefined ? [] : Array.isArray(input.findings) ? input.findings.map(parseFinding) : (() => { throw new ProposalQuoteApprovalContractError("INVALID_COMMAND", "findings must be an array."); })();
  if (findings.length > 100) throw new ProposalQuoteApprovalContractError("INVALID_COMMAND", "findings is too large.");
  if (input.decision === "approved" && findings.some((finding) => finding.status === "open" && finding.severity === "blocker")) {
    throw new ProposalQuoteApprovalContractError("APPROVAL_BLOCKED", "Proposal approval is blocked by open blocker findings.", 409);
  }
  return {
    ...common,
    caseId: id(input.caseId, "caseId"),
    commandType: "proposal.review.decide",
    decision: input.decision as ProposalReviewCommand["decision"],
    expectedProposalDocumentVersionId: id(input.expectedProposalDocumentVersionId, "expectedProposalDocumentVersionId"),
    findings: findings.sort((left, right) => left.findingKey.localeCompare(right.findingKey)),
    reviewerNotes: text(input.reviewerNotes, "reviewerNotes", 4_000),
    typedConfirmation: nullableText(input.typedConfirmation, "typedConfirmation", 200),
  };
}
