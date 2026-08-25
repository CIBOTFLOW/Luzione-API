export function runtimeConfig() {
  const production = process.env.APP_ENV === "production" || process.env.NODE_ENV === "production";
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
  const serviceTokenConfigured = Boolean(process.env.LUZIONE_API_SERVICE_TOKEN?.trim());
  const continuationSecretConfigured = Boolean(process.env.PLATFORM_CONTINUATION_SECRET?.trim());
  const mutationsRequested = process.env.LUZIONE_API_MUTATIONS_ENABLED === "true";

  return {
    continuationSecretConfigured,
    databaseConfigured,
    mutationsEnabled: mutationsRequested && databaseConfigured && serviceTokenConfigured,
    mutationsRequested,
    production,
    serviceTokenConfigured,
  };
}
