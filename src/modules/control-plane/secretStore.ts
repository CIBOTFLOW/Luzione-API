const SECRET_REF_PATTERN = /^(vault|legacy|env):[A-Za-z0-9._:/@-]{1,500}$/;

export type SecretMaterial = Readonly<Record<string, string>>;

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
