import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type {
  ObjectiveFit,
  SupplierQuoteNormalizeCommand,
} from "@/modules/seed-procurement/contracts";

function stableId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(value).slice(0, 40)}`;
}

export function evidenceArtifactIdFor(tenantId: string, artifact: { contentDigest: string; provider: string; sourceRecordRef: string }) {
  return stableId("evidence_artifact", { ...artifact, tenantId });
}
export function productSourceIdFor(tenantId: string, input: { artifactId: string; locator: string; observedAt: string }) {
  return stableId("product_source", { ...input, tenantId });
}
export function productCandidateIdFor(tenantId: string, input: { productIdentityRef: string; productSourceId: string }) {
  return stableId("product_candidate", { ...input, tenantId });
}
export function rfqIdFor(tenantId: string, input: { specificationId: string; specificationVersion: string; supplierId: string; lineVersions: Record<string, string> }) {
  return stableId("rfq", { ...input, tenantId });
}
export function supplierQuoteIdFor(tenantId: string, input: { evidenceArtifactId: string; rfqId: string; supplierId: string }) {
  return stableId("supplier_quote", { ...input, tenantId });
}
export function bidComparisonIdFor(tenantId: string, input: { projectId: string; specificationId: string; specificationVersion: string; supplierQuoteIds: string[] }) {
  return stableId("bid_comparison", { ...input, supplierQuoteIds: [...input.supplierQuoteIds].sort(), tenantId });
}
export function selectionDecisionIdFor(tenantId: string, input: { actorId: string; bidComparisonId: string; selectedSupplierQuoteId: string }) {
  return stableId("procurement_selection", { ...input, tenantId });
}
export function purchaseOrderIdFor(tenantId: string, input: { bidComparisonId: string; selectionDecisionId: string; supplierQuoteId: string }) {
  return stableId("purchase_order", { ...input, tenantId });
}
export function purchaseOrderAcknowledgementIdFor(tenantId: string, input: { evidenceArtifactId: string; purchaseOrderId: string }) {
  return stableId("purchase_order_ack", { ...input, tenantId });
}

export const procurementVersions = Object.freeze({
  evidence: (id: string) => `evidence-artifact:${id}:v1`,
  productSource: (id: string) => `product-source:${id}:v1`,
  productCandidate: (id: string) => `product-candidate:${id}:v1`,
  rfq: (id: string) => `rfq:${id}:v1`,
  supplierQuote: (id: string) => `supplier-quote:${id}:v1`,
  bidComparison: (id: string, version = 1) => `bid-comparison:${id}:v${version}`,
  selectionDecision: (id: string) => `procurement-selection:${id}:v1`,
  purchaseOrder: (id: string) => `purchase-order:${id}:v1`,
  acknowledgement: (id: string) => `purchase-order-acknowledgement:${id}:v1`,
});

export function objectiveScore(fit: ObjectiveFit) {
  const keys = Object.keys(fit.inputs).sort() as Array<keyof ObjectiveFit["inputs"]>;
  const weight = keys.reduce((sum, key) => sum + fit.weights[key], 0);
  if (!(weight > 0)) throw new Error("Objective fit weight must be positive.");
  const raw = keys.reduce((sum, key) => sum + fit.inputs[key] * fit.weights[key], 0) / weight;
  return Math.round(raw * 10_000_000) / 10_000_000;
}

export type NormalizedQuoteEconomics = {
  basisCurrency: string;
  clientPriceTotalMinor: number;
  landedTotalMinor: number;
  lines: Array<{
    clientPriceTotalMinor: number;
    dutyMinor: number;
    freightMinor: number;
    landedTotalMinor: number;
    marginMinor: number;
    objectiveFitScore: number;
    quantity: number;
    reserveMinor: number;
    rfqLineId: string;
    supplierCostTotalMinor: number;
  }>;
  marginMinor: number;
  objectiveFitScore: number;
  supplierCostTotalMinor: number;
};

function exactMinor(value: number, label: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} cannot be reconciled to safe integer minor units.`);
  return value;
}

export function normalizeQuoteEconomics(command: SupplierQuoteNormalizeCommand): NormalizedQuoteEconomics {
  const currencies = new Set(command.lines.map((line) => line.unitPrice.currency));
  if (currencies.size !== 1) throw new Error("Supplier Quote lines must share one basis currency.");
  const lines = command.lines.map((line) => {
    const supplierCostTotalMinor = exactMinor(line.unitPrice.amountMinor * line.quantity, "Supplier cost");
    const clientPriceTotalMinor = exactMinor(line.clientUnitPriceMinor * line.quantity, "Client price");
    const landedTotalMinor = exactMinor(supplierCostTotalMinor + line.freightMinor + line.dutyMinor + line.reserveMinor, "Landed total");
    return {
      clientPriceTotalMinor,
      dutyMinor: line.dutyMinor,
      freightMinor: line.freightMinor,
      landedTotalMinor,
      marginMinor: clientPriceTotalMinor - landedTotalMinor,
      objectiveFitScore: objectiveScore(line.objectiveFit),
      quantity: line.quantity,
      reserveMinor: line.reserveMinor,
      rfqLineId: line.rfqLineId,
      supplierCostTotalMinor,
    };
  });
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const supplierCostTotalMinor = exactMinor(lines.reduce((sum, line) => sum + line.supplierCostTotalMinor, 0), "Supplier cost total");
  const landedTotalMinor = exactMinor(lines.reduce((sum, line) => sum + line.landedTotalMinor, 0), "Landed total");
  const clientPriceTotalMinor = exactMinor(lines.reduce((sum, line) => sum + line.clientPriceTotalMinor, 0), "Client price total");
  return {
    basisCurrency: [...currencies][0],
    clientPriceTotalMinor,
    landedTotalMinor,
    lines,
    marginMinor: clientPriceTotalMinor - landedTotalMinor,
    objectiveFitScore: Math.round((lines.reduce((sum, line) => sum + line.objectiveFitScore * line.quantity, 0) / quantity) * 10_000_000) / 10_000_000,
    supplierCostTotalMinor,
  };
}

export function procurementInvariantDefects(input: {
  actualVersion: string;
  expectedVersion: string;
  landedTotalMinor: number;
  query: string;
  supplierCostTotalMinor: number;
}) {
  const defects: string[] = [];
  if (!/(?:\b|\.)tenant_id\s*=\s*\$1\b/i.test(input.query)) defects.push("TENANT_PREDICATE_MISSING");
  if (input.actualVersion !== input.expectedVersion) defects.push("STALE_VERSION_ACCEPTED");
  if (input.landedTotalMinor < input.supplierCostTotalMinor) defects.push("LANDED_TOTAL_CORRUPT");
  return defects;
}
