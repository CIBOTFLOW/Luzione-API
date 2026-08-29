import "server-only";

import { databasePool } from "@/lib/db";
import type { SecretMaterial } from "@/modules/control-plane/secretStore";
import {
  configuredEnvironmentSecretNames,
  configuredWebhookProviders,
  ensureRuntimeWebhookProvider as ensureConfiguredRuntimeWebhookProvider,
} from "@/modules/control-plane/webhookRuntime";
import { providerWebhookRegistry } from "@/modules/control-plane/webhook";

function environmentMaterial(name: string): SecretMaterial | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    if (!Object.values(parsed).every((value) => typeof value === "string")) return undefined;
    return parsed as SecretMaterial;
  } catch {
    return undefined;
  }
}

export function ensureRuntimeWebhookProvider(provider: string) {
  const allowedProviders = configuredWebhookProviders(process.env.LUZIONE_WEBHOOK_PROVIDERS);
  if (!allowedProviders.has(provider)) return false;
  return ensureConfiguredRuntimeWebhookProvider(provider, providerWebhookRegistry, {
    allowedEnvironmentNames: configuredEnvironmentSecretNames(process.env.LUZIONE_ENV_SECRET_ALLOWLIST),
    allowedProviders,
    database: databasePool(),
    environmentResolver: environmentMaterial,
  });
}
