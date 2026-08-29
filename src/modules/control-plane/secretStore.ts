const SECRET_REF_PATTERN = /^(vault|legacy|env):[A-Za-z0-9._:/@-]{1,500}$/;
const VAULT_REF_PATTERN = /^vault:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const ENVIRONMENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const MAX_SECRET_KEYS = 64;
const MAX_SERIALIZED_SECRET_BYTES = 65_536;

export type SecretMaterial = Readonly<Record<string, string>>;

type Queryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export interface SecretStore {
  readonly backend: "VAULT" | "LEGACY" | "ENVIRONMENT" | "UNAVAILABLE";
  delete(ref: string): Promise<void>;
  read(ref: string): Promise<SecretMaterial>;
  write(input: SecretMaterial): Promise<string>;
}

export function assertOpaqueSecretRef(value: string) {
  if (!SECRET_REF_PATTERN.test(value)) {
    throw new Error("Connection credentials must be represented by an opaque vault:, legacy:, or env: reference.");
  }
  return value;
}

function validateSecretMaterial(input: unknown): SecretMaterial {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Secret material must be a bounded object of string values.");
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_SECRET_KEYS) {
    throw new Error("Secret material must contain between 1 and 64 fields.");
  }
  const material: Record<string, string> = {};
  for (const [key, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key) || typeof value !== "string" || value.length === 0) {
      throw new Error("Secret material contains an invalid field.");
    }
    material[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(material), "utf8") > MAX_SERIALIZED_SECRET_BYTES) {
    throw new Error("Secret material exceeds the secure storage limit.");
  }
  return Object.freeze(material);
}

function decodeSecretMaterial(value: string) {
  try {
    return validateSecretMaterial(JSON.parse(value));
  } catch {
    throw new Error("Secure storage returned invalid secret material.");
  }
}

export class ReadOnlyLegacySecretStore implements SecretStore {
  readonly backend = "LEGACY" as const;

  constructor(private readonly resolve: (ref: string) => Promise<SecretMaterial>) {}

  async read(ref: string) {
    const checked = assertOpaqueSecretRef(ref);
    if (!checked.startsWith("legacy:")) throw new Error("Legacy store only accepts legacy: references.");
    return this.resolve(checked);
  }

  async write(): Promise<string> {
    throw new Error("New secret writes are blocked while the tenant is on the legacy secret backend.");
  }

  async delete(): Promise<void> {
    throw new Error("Legacy credential deletion requires a separately approved provider migration.");
  }
}

export class UnavailableSecretStore implements SecretStore {
  readonly backend = "UNAVAILABLE" as const;

  async read(): Promise<SecretMaterial> {
    throw new Error("The selected secure secret backend is unavailable.");
  }

  async write(): Promise<string> {
    throw new Error("New secret writes are blocked because the selected secure backend is unavailable.");
  }

  async delete(): Promise<void> {
    throw new Error("Secret deletion is blocked because the selected secure backend is unavailable.");
  }
}

export class ReadOnlyEnvironmentSecretStore implements SecretStore {
  readonly backend = "ENVIRONMENT" as const;

  constructor(
    private readonly allowedNames: ReadonlySet<string>,
    private readonly resolve: (name: string) => SecretMaterial | undefined,
  ) {}

  async read(ref: string) {
    const checked = assertOpaqueSecretRef(ref);
    if (!checked.startsWith("env:")) throw new Error("Environment store only accepts env: references.");
    const name = checked.slice(4);
    if (!ENVIRONMENT_NAME_PATTERN.test(name) || !this.allowedNames.has(name)) {
      throw new Error("The environment secret reference is not allowlisted for this workload.");
    }
    const material = this.resolve(name);
    if (!material) throw new Error("The allowlisted environment secret is unavailable.");
    return validateSecretMaterial(material);
  }

  async write(): Promise<string> {
    throw new Error("Environment-backed service credentials cannot be written through the connection API.");
  }

  async delete(): Promise<void> {
    throw new Error("Environment-backed service credentials require separately approved credential rotation.");
  }
}

export class PostgresVaultSecretStore implements SecretStore {
  readonly backend = "VAULT" as const;

  constructor(
    private readonly database: Queryable,
    private readonly tenantId: string,
  ) {}

  async read(ref: string) {
    const match = VAULT_REF_PATTERN.exec(assertOpaqueSecretRef(ref));
    if (!match) throw new Error("Vault store only accepts a canonical vault: UUID reference.");
    const result = await this.database.query<{ secret_material: string }>(
      "select luzione_api_private.read_vault_secret($1::uuid, $2::uuid) as secret_material",
      [this.tenantId, match[1]],
    );
    if (result.rows.length !== 1 || typeof result.rows[0].secret_material !== "string") {
      throw new Error("The tenant-bound Vault secret is unavailable.");
    }
    return decodeSecretMaterial(result.rows[0].secret_material);
  }

  async write(input: SecretMaterial) {
    const material = validateSecretMaterial(input);
    const result = await this.database.query<{ vault_secret_id: string }>(
      "select luzione_api_private.create_vault_secret($1::uuid, $2::text) as vault_secret_id",
      [this.tenantId, JSON.stringify(material)],
    );
    const id = result.rows[0]?.vault_secret_id;
    if (typeof id !== "string" || !VAULT_REF_PATTERN.test(`vault:${id}`)) {
      throw new Error("Vault did not return a valid opaque secret reference.");
    }
    return `vault:${id}`;
  }

  async delete(): Promise<void> {
    throw new Error("Vault secret deletion requires a separately approved credential-removal command.");
  }
}

export class RoutedSecretStore implements SecretStore {
  readonly backend = "UNAVAILABLE" as const;

  constructor(
    private readonly stores: Readonly<Partial<Record<"env" | "legacy" | "vault", SecretStore>>>,
    private readonly writeStore?: SecretStore,
  ) {}

  private route(ref: string) {
    const checked = assertOpaqueSecretRef(ref);
    const prefix = checked.slice(0, checked.indexOf(":")) as "env" | "legacy" | "vault";
    const store = this.stores[prefix];
    if (!store) throw new Error("The selected secret backend is unavailable.");
    return { checked, store };
  }

  async read(ref: string) {
    const { checked, store } = this.route(ref);
    return store.read(checked);
  }

  async write(input: SecretMaterial) {
    if (!this.writeStore) {
      throw new Error("New secret writes are blocked because no validated secure backend is selected.");
    }
    return this.writeStore.write(input);
  }

  async delete(ref: string) {
    const { checked, store } = this.route(ref);
    return store.delete(checked);
  }
}
