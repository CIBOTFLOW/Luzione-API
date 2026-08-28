const tlsQueryParameters = Object.freeze([
  "ssl",
  "sslcert",
  "sslkey",
  "sslmode",
  "sslnegotiation",
  "sslrootcert",
  "uselibpqcompat",
]);

const localDatabaseHosts = new Set(["127.0.0.1", "[::1]", "::1", "localhost"]);

export type DatabaseConnectionOptions = {
  connectionString: string;
  ssl?: {
    ca?: string;
    rejectUnauthorized: boolean;
  };
};

export type DatabaseRuntimeProfile = {
  host: string;
  poolerRecommended: boolean;
  poolerDetected: boolean;
  tlsVerification: "CA_VERIFIED" | "ENCRYPTED_UNVERIFIED" | "LOCAL";
};

function normalizeCertificate(certificate: string | undefined) {
  const normalized = certificate?.trim().replace(/\\n/g, "\n");
  return normalized || undefined;
}

/**
 * Build a node-postgres connection config without allowing TLS parameters in
 * DATABASE_URL to replace the explicit application TLS policy.
 *
 * node-postgres documents that ssl/sslmode/sslrootcert-style URL parameters
 * replace the separate `ssl` object. Supabase's generated URLs commonly carry
 * sslmode=require, so the URL must be normalized before the Pool is created.
 */
export function databaseConnectionOptions(
  rawConnectionString: string,
  caCertificate?: string,
): DatabaseConnectionOptions {
  const connectionString = rawConnectionString.trim();
  const parsed = new URL(connectionString);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme.");
  }

  if (localDatabaseHosts.has(parsed.hostname)) {
    return { connectionString };
  }

  for (const parameter of tlsQueryParameters) parsed.searchParams.delete(parameter);
  const ca = normalizeCertificate(caCertificate);

  return {
    connectionString: parsed.toString(),
    ssl: ca
      ? { ca, rejectUnauthorized: true }
      : { rejectUnauthorized: false },
  };
}

export function databaseRuntimeProfile(
  rawConnectionString: string,
  caCertificate?: string,
): DatabaseRuntimeProfile {
  const parsed = new URL(rawConnectionString.trim());
  const local = localDatabaseHosts.has(parsed.hostname);
  const poolerDetected = parsed.hostname.includes("pooler.supabase.com")
    || parsed.port === "6543";
  return {
    host: parsed.hostname,
    poolerDetected,
    poolerRecommended: !local && !poolerDetected,
    tlsVerification: local
      ? "LOCAL"
      : normalizeCertificate(caCertificate)
        ? "CA_VERIFIED"
        : "ENCRYPTED_UNVERIFIED",
  };
}
