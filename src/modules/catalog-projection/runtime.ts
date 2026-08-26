import crypto from "node:crypto";

export const P113_INGEST_CONTRACT_VERSION = "2026-08-26.p113.api-ingest.v1";
export const P113_PROJECTION_CONTRACT_VERSION = "2026-08-19.p113.v1";
export const P113_SOURCE_OF_TRUTH = "p113_catalog_quote_selection_projection";

const MAX_PRODUCTS = 25_000;
const MAX_VARIANTS = 100_000;
const MAX_CURSORS = 100_000;
const authorityKeys = new Set([
  "actor",
  "actorId",
  "actorType",
  "approve",
  "customerSend",
  "externalEffect",
  "externalWriteAuthorized",
  "order",
  "payment",
  "providerSuccess",
  "shopifyWrite",
  "tenant",
  "tenantId",
]);

export type P113SourceCounts = {
  productCount: number;
  productCountPrecision: string | null;
  variantCount: number;
  variantCountPrecision: string | null;
};

export type P113CursorObservation = {
  cursorValue: string | null;
  hasNextPage: boolean;
  kind: string;
  observedCount: number;
  ownerRef: string;
  pageOrdinal: number;
};

export type P113CatalogVariant = {
  id: string | null;
  inventoryQuantity: number | null;
  price: string | null;
  sku: string | null;
  title: string | null;
};

export type P113CatalogProduct = {
  handle: string;
  id: string;
  productType: string;
  shopifyProductId: string;
  sourceUpdatedAt: string | null;
  status: string;
  tags: string[];
  title: string;
  variants: P113CatalogVariant[];
  vendor: string;
};

export type P113MappingEvidence = {
  freshness: string | null;
  manufacturerNormalized: string | null;
  manufacturerRaw: string | null;
  mappingId: string | null;
  mappingState: string | null;
  productRef: string;
  sourceVersionId: string | null;
};

export type P113IngestCommand = {
  contractVersion: typeof P113_INGEST_CONTRACT_VERSION;
  cursors: P113CursorObservation[];
  products: P113CatalogProduct[];
  sourceCounts: P113SourceCounts;
};

export type P113CatalogSelection = {
  blockedReasons: string[];
  lastSyncedAt: string;
  manufacturer: string | null;
  ownerRefs: {
    p107Mapping: string | null;
    shopifyProduct: string;
    shopifyVariant: string;
  };
  price: string | null;
  productId: string;
  productType: string;
  quoteSelectable: boolean;
  resolutionAction: string | null;
  selectionKey: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  sku: string | null;
  sourceUpdatedAt: string | null;
  sourceVersion: string;
  status: string;
  tags: string[];
  title: string;
  variantTitle: string;
  vendor: string;
};

export type P113ProjectionRow = {
  blockedReasons: string[];
  lastSyncedAt: string;
  p107MappingRef: string | null;
  payload: P113CatalogSelection;
  payloadHash: string;
  projectionId: string;
  quoteSelectable: boolean;
  searchText: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  sourceUpdatedAt: string | null;
  sourceVersion: string;
  status: string;
};

export type P113Completion = {
  blockedVariantCount: number;
  coveragePercent: number;
  eligibleVariantCount: number;
  exactSourceCountMatch: boolean;
  productsObserved: number;
  projections: P113ProjectionRow[];
  state: "CURRENT" | "RECONCILIATION_REQUIRED";
  variantsObserved: number;
};

export class P113ContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "P113ContractError";
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new P113ContractError("P113_INVALID_REQUEST", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, options: { max?: number; nullable?: boolean } = {}) {
  if (options.nullable && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new P113ContractError("P113_INVALID_REQUEST", `${label} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > (options.max ?? 512)) {
    throw new P113ContractError("P113_INVALID_REQUEST", `${label} exceeds its size limit.`);
  }
  return normalized;
}

function optionalString(value: unknown, label: string, max = 512) {
  return stringValue(value, label, { max, nullable: true });
}

function requiredString(value: unknown, label: string, max = 512) {
  return stringValue(value, label, { max }) as string;
}

function integer(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new P113ContractError("P113_INVALID_REQUEST", `${label} must be a non-negative integer.`);
  }
  return Number(value);
}

function nullableNumber(value: unknown, label: string) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new P113ContractError("P113_INVALID_REQUEST", `${label} must be a finite number or null.`);
  }
  return value;
}

function parseVariant(value: unknown, index: number): P113CatalogVariant {
  const item = record(value, `products[].variants[${index}]`);
  return {
    id: optionalString(item.id, `products[].variants[${index}].id`),
    inventoryQuantity: nullableNumber(
      item.inventoryQuantity,
      `products[].variants[${index}].inventoryQuantity`,
    ),
    price: optionalString(item.price, `products[].variants[${index}].price`, 128),
    sku: optionalString(item.sku, `products[].variants[${index}].sku`, 256),
    title: optionalString(item.title, `products[].variants[${index}].title`, 1_000),
  };
}

function parseProduct(value: unknown, index: number): P113CatalogProduct {
  const item = record(value, `products[${index}]`);
  const variants = Array.isArray(item.variants) ? item.variants : [];
  const tags = Array.isArray(item.tags) ? item.tags : [];
  if (tags.length > 250) {
    throw new P113ContractError("P113_INVALID_REQUEST", `products[${index}].tags exceeds its size limit.`);
  }
  return {
    handle: optionalString(item.handle, `products[${index}].handle`, 512) ?? "",
    id: optionalString(item.id, `products[${index}].id`) ?? requiredString(
      item.shopifyProductId,
      `products[${index}].shopifyProductId`,
    ),
    productType: optionalString(item.productType, `products[${index}].productType`, 512) ?? "",
    shopifyProductId: requiredString(item.shopifyProductId, `products[${index}].shopifyProductId`),
    sourceUpdatedAt: optionalString(item.sourceUpdatedAt, `products[${index}].sourceUpdatedAt`, 64),
    status: optionalString(item.status, `products[${index}].status`, 128) ?? "UNKNOWN",
    tags: tags.map((tag, tagIndex) => requiredString(tag, `products[${index}].tags[${tagIndex}]`, 256)),
    title: requiredString(item.title, `products[${index}].title`, 2_000),
    variants: variants.map(parseVariant),
    vendor: optionalString(item.vendor, `products[${index}].vendor`, 512) ?? "",
  };
}

function parseCursor(value: unknown, index: number): P113CursorObservation {
  const item = record(value, `cursors[${index}]`);
  if (typeof item.hasNextPage !== "boolean") {
    throw new P113ContractError("P113_INVALID_REQUEST", `cursors[${index}].hasNextPage must be boolean.`);
  }
  return {
    cursorValue: optionalString(item.cursorValue, `cursors[${index}].cursorValue`, 2_000),
    hasNextPage: item.hasNextPage,
    kind: requiredString(item.kind, `cursors[${index}].kind`, 128),
    observedCount: integer(item.observedCount, `cursors[${index}].observedCount`),
    ownerRef: requiredString(item.ownerRef, `cursors[${index}].ownerRef`, 1_000),
    pageOrdinal: integer(item.pageOrdinal, `cursors[${index}].pageOrdinal`),
  };
}

export function parseP113IngestCommand(value: unknown): P113IngestCommand {
  const input = record(value, "request body");
  const forged = Object.keys(input).filter((key) => authorityKeys.has(key));
  if (forged.length > 0) {
    throw new P113ContractError(
      "P113_AUTHORITY_FORGED",
      `Tenant, actor, approval, and external-effect authority are derived server-side; remove: ${forged.join(", ")}.`,
    );
  }
  if (input.contractVersion !== P113_INGEST_CONTRACT_VERSION) {
    throw new P113ContractError(
      "P113_UNSUPPORTED_VERSION",
      `contractVersion must be ${P113_INGEST_CONTRACT_VERSION}.`,
    );
  }
  if (!Array.isArray(input.products) || input.products.length > MAX_PRODUCTS) {
    throw new P113ContractError("P113_REQUEST_TOO_LARGE", `products must contain at most ${MAX_PRODUCTS} items.`, 413);
  }
  if (!Array.isArray(input.cursors) || input.cursors.length > MAX_CURSORS) {
    throw new P113ContractError("P113_REQUEST_TOO_LARGE", `cursors must contain at most ${MAX_CURSORS} items.`, 413);
  }
  const products = input.products.map(parseProduct);
  const variantCount = products.reduce((total, product) => total + Math.max(1, product.variants.length), 0);
  if (variantCount > MAX_VARIANTS) {
    throw new P113ContractError("P113_REQUEST_TOO_LARGE", `products contain more than ${MAX_VARIANTS} variants.`, 413);
  }
  const source = record(input.sourceCounts, "sourceCounts");
  return {
    contractVersion: P113_INGEST_CONTRACT_VERSION,
    cursors: input.cursors.map(parseCursor),
    products,
    sourceCounts: {
      productCount: integer(source.productCount, "sourceCounts.productCount"),
      productCountPrecision: optionalString(source.productCountPrecision, "sourceCounts.productCountPrecision", 32),
      variantCount: integer(source.variantCount, "sourceCounts.variantCount"),
      variantCountPrecision: optionalString(source.variantCountPrecision, "sourceCounts.variantCountPrecision", 32),
    },
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashP113Payload(value: unknown) {
  return crypto.createHash("sha256").update(stable(value)).digest("hex");
}

export function p113SyncRunId(tenantId: string, idempotencyKey: string) {
  return `p113run_${hashP113Payload({ idempotencyKey, tenantId }).slice(0, 32)}`;
}

function mappingIndex(mappings: P113MappingEvidence[]) {
  const index = new Map<string, P113MappingEvidence>();
  for (const mapping of mappings) index.set(mapping.productRef, mapping);
  return index;
}

function ratio(observed: number, expected: number) {
  if (expected === 0) return observed === 0 ? 1 : 0;
  return Math.min(1, observed / expected);
}

export function buildP113Completion(
  command: P113IngestCommand,
  mappings: P113MappingEvidence[],
  observedAt: string,
): P113Completion {
  const mappingByRef = mappingIndex(mappings);
  const selections: P113CatalogSelection[] = [];
  const observedSourceVariants = new Set<string>();

  for (const product of command.products) {
    const variants = product.variants.length > 0
      ? product.variants
      : [{ id: null, inventoryQuantity: null, price: null, sku: null, title: "Default" }];
    for (const variant of variants) {
      const variantIdentity = `${product.shopifyProductId}\u0000${variant.id ?? "default"}`;
      if (observedSourceVariants.has(variantIdentity)) {
        throw new P113ContractError(
          "P113_DUPLICATE_SOURCE_ID",
          "A Shopify product/variant identity was observed more than once.",
        );
      }
      observedSourceVariants.add(variantIdentity);
      const mapping = [
        product.id,
        product.shopifyProductId,
        product.handle,
        variant.id,
        variant.sku,
      ].filter((key): key is string => Boolean(key)).map((key) => mappingByRef.get(key)).find(Boolean) ?? null;
      const blockedReasons: string[] = [];
      if (!/^active$/i.test(product.status)) blockedReasons.push("product_not_active_or_archived");
      if (!variant.id) blockedReasons.push("variant_missing_source_id");
      if (!mapping) blockedReasons.push("p107_mapping_missing");
      if (mapping?.mappingState && mapping.mappingState !== "accepted") {
        blockedReasons.push(`p107_mapping_${mapping.mappingState}`);
      }
      if (mapping?.freshness && mapping.freshness !== "current") {
        blockedReasons.push(`p107_mapping_${mapping.freshness}`);
      }
      const variantId = variant.id ?? `${product.shopifyProductId}:default`;
      const sourceVersion = hashP113Payload({
        mapping: mapping?.mappingId ?? mapping?.sourceVersionId ?? null,
        product: product.shopifyProductId,
        sourceUpdatedAt: product.sourceUpdatedAt,
        variant,
      });
      const variantTitle = variant.title ?? "Default";
      const title = [
        product.title,
        variantTitle !== "Default Title" ? variantTitle : null,
      ].filter(Boolean).join(" / ");
      selections.push({
        blockedReasons,
        lastSyncedAt: observedAt,
        manufacturer: mapping?.manufacturerNormalized ?? mapping?.manufacturerRaw ?? null,
        ownerRefs: {
          p107Mapping: mapping?.mappingId ?? mapping?.sourceVersionId ?? null,
          shopifyProduct: product.shopifyProductId,
          shopifyVariant: variantId,
        },
        price: variant.price,
        productId: product.id,
        productType: product.productType,
        quoteSelectable: blockedReasons.length === 0,
        resolutionAction: blockedReasons.length > 0
          ? "Resolve Shopify active status, exact variant identity, and current accepted P107 mapping evidence before quote selection."
          : null,
        selectionKey: `p113sel_${sourceVersion.slice(0, 24)}`,
        shopifyProductId: product.shopifyProductId,
        shopifyVariantId: variantId,
        sku: variant.sku,
        sourceUpdatedAt: product.sourceUpdatedAt,
        sourceVersion,
        status: product.status,
        tags: product.tags,
        title,
        variantTitle,
        vendor: product.vendor,
      });
    }
  }

  const productsObserved = command.products.length;
  const variantsObserved = selections.length;
  const exactPrecision = command.sourceCounts.productCountPrecision?.toUpperCase() === "EXACT"
    && command.sourceCounts.variantCountPrecision?.toUpperCase() === "EXACT";
  const exactSourceCountMatch = exactPrecision
    && productsObserved === command.sourceCounts.productCount
    && variantsObserved === command.sourceCounts.variantCount;
  const coverageRatio = Math.min(
    ratio(productsObserved, command.sourceCounts.productCount),
    ratio(variantsObserved, command.sourceCounts.variantCount),
  );
  const coveragePercent = exactSourceCountMatch
    ? 100
    : Math.min(99.99, Math.round(coverageRatio * 10_000) / 100);
  if (!exactSourceCountMatch) {
    for (const selection of selections) {
      if (!selection.blockedReasons.includes("catalog_coverage_not_current")) {
        selection.blockedReasons.push("catalog_coverage_not_current");
      }
      selection.quoteSelectable = false;
      selection.resolutionAction = "Reconcile the exact Shopify product and variant cursor walk before quote selection.";
    }
  }
  const projections = selections.map((selection) => ({
    blockedReasons: selection.blockedReasons,
    lastSyncedAt: selection.lastSyncedAt,
    p107MappingRef: selection.ownerRefs.p107Mapping,
    payload: selection,
    payloadHash: hashP113Payload(selection),
    projectionId: selection.selectionKey,
    quoteSelectable: selection.quoteSelectable,
    searchText: [
      selection.title,
      selection.sku,
      selection.vendor,
      selection.manufacturer,
      selection.productType,
      selection.tags.join(" "),
    ].filter(Boolean).join(" "),
    shopifyProductId: selection.shopifyProductId,
    shopifyVariantId: selection.shopifyVariantId,
    sourceUpdatedAt: selection.sourceUpdatedAt,
    sourceVersion: selection.sourceVersion,
    status: selection.status,
  }));

  return {
    blockedVariantCount: selections.filter((selection) => !selection.quoteSelectable).length,
    coveragePercent,
    eligibleVariantCount: selections.filter((selection) => selection.quoteSelectable).length,
    exactSourceCountMatch,
    productsObserved,
    projections,
    state: exactSourceCountMatch ? "CURRENT" : "RECONCILIATION_REQUIRED",
    variantsObserved,
  };
}
