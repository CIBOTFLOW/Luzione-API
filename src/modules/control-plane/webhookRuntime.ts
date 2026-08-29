import {
  PostgresVaultSecretStore,
  ReadOnlyEnvironmentSecretStore,
  RoutedSecretStore,
  type SecretMaterial,
} from "./secretStore";
import {
  HmacSha256WebhookVerifier,
  type ProviderWebhookRegistry,
} from "./webhook";

export type WebhookRuntimeDatabase = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type RuntimeWebhookOptions = {
  allowedEnvironmentNames?: ReadonlySet<string>;
  allowedProviders?: ReadonlySet<string>;
  database: WebhookRuntimeDatabase;
  environmentResolver?: (name: string) => SecretMaterial | undefined;
};

const PROVIDER_PATTERN = /^[a-z][a-z0-9._-]{0,199}$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const initializedProviders = new WeakMap<ProviderWebhookRegistry, Set<string>>();

function configuredValues(raw: string | undefined, pattern: RegExp) {
  const values = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => pattern.test(value));
  return new Set(values);
}

export function configuredWebhookProviders(raw: string | undefined) {
  return configuredValues(raw, PROVIDER_PATTERN);
}

export function configuredEnvironmentSecretNames(raw: string | undefined) {
  return configuredValues(raw, ENVIRONMENT_NAME_PATTERN);
}

export function buildRuntimeWebhookVerifier(provider: string, options: RuntimeWebhookOptions) {
  if (!PROVIDER_PATTERN.test(provider)) throw new Error("Webhook provider code is invalid.");
  const allowedEnvironmentNames = options.allowedEnvironmentNames ?? new Set<string>();
  const resolveEnvironment = options.environmentResolver ?? (() => undefined);

  return new HmacSha256WebhookVerifier(async (endpointKey) => {
    const result = await options.database.query<{
      connection_id: string;
      secret_ref: string;
      tenant_id: string;
    }>(
      `select connection_id::text, tenant_id::text, secret_ref
         from public.integration_connections
        where provider = $1
          and configuration ->> 'webhookEndpointKey' = $2
          and state = 'CONNECTED'
          and last_validation_status = 'PASS'
          and not kill_switch_active
          and secret_ref ~ '^(vault|env):'
        order by connection_id
        limit 2`,
      [provider, endpointKey],
    );
    if (result.rows.length !== 1) return null;
    const endpoint = result.rows[0];
    const store = new RoutedSecretStore({
      env: new ReadOnlyEnvironmentSecretStore(allowedEnvironmentNames, resolveEnvironment),
      vault: new PostgresVaultSecretStore(options.database, endpoint.tenant_id),
    });
    const material = await store.read(endpoint.secret_ref);
    const secret = material.webhookHmacSha256;
    if (typeof secret !== "string" || secret.length < 32 || secret.length > 1_024) return null;
    return {
      connectionId: endpoint.connection_id,
      secret,
      tenantId: endpoint.tenant_id,
    };
  });
}

export function ensureRuntimeWebhookProvider(
  provider: string,
  registry: ProviderWebhookRegistry,
  options: RuntimeWebhookOptions,
) {
  const allowedProviders = options.allowedProviders ?? new Set<string>();
  if (!allowedProviders.has(provider)) return false;
  let initialized = initializedProviders.get(registry);
  if (!initialized) {
    initialized = new Set<string>();
    initializedProviders.set(registry, initialized);
  }
  if (initialized.has(provider)) return true;
  registry.register(provider, buildRuntimeWebhookVerifier(provider, options));
  initialized.add(provider);
  return true;
}
