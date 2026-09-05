export function runtimeConfig() {
  const production = process.env.APP_ENV === "production" || process.env.NODE_ENV === "production";
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
  const serviceTokenConfigured = Boolean(process.env.LUZIONE_API_SERVICE_TOKEN?.trim());
  const continuationSecretConfigured = Boolean(process.env.PLATFORM_CONTINUATION_SECRET?.trim());
  const mutationsRequested = process.env.LUZIONE_API_MUTATIONS_ENABLED === "true";
  const internalProjectionsRequested = process.env.LUZIONE_API_INTERNAL_PROJECTIONS_ENABLED === "true";
  const internalProjectionAdmissionConfigured =
    allowlist("LUZIONE_API_INTERNAL_PROJECTION_TENANTS").size > 0
    && allowlist("LUZIONE_API_INTERNAL_PROJECTION_SOURCES").size > 0;

  return {
    continuationSecretConfigured,
    databaseConfigured,
    internalProjectionsEnabled:
      mutationsRequested
      && internalProjectionsRequested
      && internalProjectionAdmissionConfigured
      && databaseConfigured
      && serviceTokenConfigured,
    internalProjectionAdmissionConfigured,
    internalProjectionsRequested,
    mutationsEnabled: mutationsRequested && databaseConfigured && serviceTokenConfigured,
    mutationsRequested,
    production,
    serviceTokenConfigured,
  };
}

function domainCommandTenantAllowlist() {
  return new Set(
    (process.env.LUZIONE_API_DOMAIN_COMMAND_TENANTS ?? "")
      .split(",")
      .map((tenantId) => tenantId.trim())
      .filter(Boolean),
  );
}

export function domainCommandsEnabledForTenant(tenantId: string) {
  return runtimeConfig().mutationsEnabled && domainCommandTenantAllowlist().has(tenantId);
}

function allowlist(name: string) {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function internalProjectionsEnabledFor(input: { source: string; tenantId: string }) {
  return runtimeConfig().internalProjectionsEnabled
    && allowlist("LUZIONE_API_INTERNAL_PROJECTION_TENANTS").has(input.tenantId)
    && allowlist("LUZIONE_API_INTERNAL_PROJECTION_SOURCES").has(input.source);
}

export function onboardingCoreEnabledForTenant(tenantId: string) {
  return runtimeConfig().mutationsEnabled
    && process.env.LUZIONE_API_ONBOARDING_CORE_ENABLED === "true"
    && allowlist("LUZIONE_API_ONBOARDING_CORE_TENANTS").has(tenantId);
}

export function providerAdapterEnabled(input: { destination: string; mode: "LIVE" | "SANDBOX"; tenantId: string }) {
  const prefix = input.mode === "LIVE" ? "LUZIONE_API_PROVIDER_LIVE" : "LUZIONE_API_PROVIDER_SANDBOX";
  return runtimeConfig().mutationsEnabled
    && process.env[`${prefix}_ENABLED`] === "true"
    && allowlist(`${prefix}_TENANTS`).has(input.tenantId)
    && allowlist(`${prefix}_DESTINATIONS`).has(input.destination);
}
