import type { EffectKillState } from "@/modules/effect-admission/contracts";
import {
  CONNECTOR_REVOCATION_V2_DESTINATION,
  assertKillStateOpenV2,
  type RevocationKillPairV2,
} from "./contracts";

export const CONNECTOR_REVOCATION_V2_CONTAINMENT_DESTINATION = "sandbox.connector-revocation-containment" as const;

export type RevocationKillReaderV2 = {
  read(input: { destination: string; tenantId: string }): Promise<EffectKillState>;
};

export class RevocationPhaseKillGuardV2 {
  beforeCredentialHold: RevocationKillPairV2 | null = null;
  beforeExecuteOrDisposition: RevocationKillPairV2 | null = null;

  constructor(private readonly reader: RevocationKillReaderV2, private readonly tenantId: string) {}

  async accepted() {
    return this.readPair("accepted");
  }

  async recheckBeforeCredentialHold() {
    this.beforeCredentialHold = await this.readPair("beforeCredentialHold");
    return this.beforeCredentialHold;
  }

  async recheckBeforeExecuteOrDisposition() {
    this.beforeExecuteOrDisposition = await this.readPair("beforeExecuteOrDisposition");
    return this.beforeExecuteOrDisposition;
  }

  private async readPair(phase: string): Promise<RevocationKillPairV2> {
    const containment = await this.reader.read({ destination: CONNECTOR_REVOCATION_V2_CONTAINMENT_DESTINATION, tenantId: this.tenantId });
    const normal = await this.reader.read({ destination: CONNECTOR_REVOCATION_V2_DESTINATION, tenantId: this.tenantId });
    return Object.freeze({
      containmentKillVersion: assertKillStateOpenV2(containment, `${phase}.containment`),
      normalKillVersion: assertKillStateOpenV2(normal, `${phase}.normal`),
    });
  }
}

