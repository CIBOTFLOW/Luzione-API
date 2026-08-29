import crypto from "node:crypto";

import { AutonomyRequestError } from "./parser";

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function autonomyRecordDigest(value: unknown) {
  return crypto.createHash("sha256").update(canonicalize(value)).digest("hex");
}

const DURABLE_REFERENCE = /^[A-Za-z][A-Za-z0-9._:/@-]{0,499}$/;

export function assertDurableReferences(values: string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new AutonomyRequestError("INVALID_REQUEST", `${label} must not contain duplicates.`);
  }
  const invalid = values.find((value) => !DURABLE_REFERENCE.test(value));
  if (invalid) {
    throw new AutonomyRequestError(
      "INVALID_REQUEST",
      `${label} must contain stable opaque references, not copied content or signed URLs.`,
    );
  }
  return values;
}

export function boundedLedgerLimit(raw: string | null, fallback = 50) {
  if (raw === null) return fallback;
  if (!/^[1-9][0-9]{0,2}$/.test(raw)) {
    throw new AutonomyRequestError("INVALID_REQUEST", "limit must be an integer from 1 to 100.");
  }
  const value = Number(raw);
  if (value > 100) {
    throw new AutonomyRequestError("INVALID_REQUEST", "limit must be an integer from 1 to 100.");
  }
  return value;
}
