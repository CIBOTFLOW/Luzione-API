import { readFile, stat } from "node:fs/promises";

const required = [
  "docs/compliance/CONTROL_MATRIX.md",
  "docs/compliance/INCIDENT_RESPONSE.md",
  "docs/compliance/ACCESS_CONTROL.md",
  "docs/compliance/CHANGE_MANAGEMENT.md",
  "docs/compliance/BACKUP_AND_RECOVERY.md",
  "docs/compliance/VENDOR_AND_DATA_REGISTER.md",
  "docs/compliance/SECURE_DEVELOPMENT.md",
];

const maximumReviewAgeDays = 370;
const now = Date.now();
for (const path of required) {
  await stat(path);
  const content = await readFile(path, "utf8");
  const match = content.match(/^Last reviewed: (\d{4}-\d{2}-\d{2})$/m);
  if (!match) throw new Error(`${path} must include Last reviewed: YYYY-MM-DD.`);
  const reviewedAt = Date.parse(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(reviewedAt) || now - reviewedAt > maximumReviewAgeDays * 86_400_000) {
    throw new Error(`${path} review is stale.`);
  }
  if (/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|service_role\s*[:=]\s*[A-Za-z0-9_-]{20}/i.test(content)) {
    throw new Error(`${path} appears to contain secret material.`);
  }
}
console.log(`Verified ${required.length} compliance control documents.`);
