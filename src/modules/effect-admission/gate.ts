import type { Pool } from "pg";

import {
  configuredEffectAdmissionPolicy,
  decideEffectAdmission,
  killState,
  unavailableKillState,
  type EffectAdmissionDecision,
  type EffectAdmissionPolicy,
  type EffectAdmissionSubject,
  type EffectKillState,
} from "@/modules/effect-admission/contracts";

export type EffectAdmissionGate = {
  decide(subject: EffectAdmissionSubject, prior?: EffectAdmissionDecision | null): Promise<EffectAdmissionDecision>;
};

export type EffectKillStateReader = {
  read(input: { destination: string; tenantId: string }): Promise<EffectKillState>;
};

export class DefaultOffEffectAdmissionGate implements EffectAdmissionGate {
  async decide(subject: EffectAdmissionSubject, prior: EffectAdmissionDecision | null = null) {
    return decideEffectAdmission(subject, killState([]), { admittedBindings: new Set(), enabled: false }, prior);
  }
}

export class ConfiguredEffectAdmissionGate implements EffectAdmissionGate {
  constructor(
    private readonly reader: EffectKillStateReader,
    private readonly policy: () => EffectAdmissionPolicy = configuredEffectAdmissionPolicy,
  ) {}

  async decide(subject: EffectAdmissionSubject, prior: EffectAdmissionDecision | null = null) {
    let state: EffectKillState;
    try {
      state = await this.reader.read({ destination: subject.destination, tenantId: subject.tenantId });
    } catch {
      state = unavailableKillState();
    }
    return decideEffectAdmission(subject, state, this.policy(), prior);
  }
}

export class StaticEffectAdmissionGate extends ConfiguredEffectAdmissionGate {
  constructor(
    state: EffectKillState,
    policy: EffectAdmissionPolicy,
  ) {
    super({ read: async () => state }, () => policy);
  }
}

export class PostgresEffectKillStateReader implements EffectKillStateReader {
  constructor(private readonly pool: Pool) {}

  async read(input: { destination: string; tenantId: string }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('app.tenant_id', $1, true)", [input.tenantId]);
      const result = await client.query(
        `select switch_id,scope_type,scope_ref,active,activated_at,deactivated_at
           from public.p110_kill_switches
          where tenant_id = $1
            and (scope_type = 'GLOBAL' or (scope_type = 'DESTINATION' and scope_ref = $2))
          order by scope_type,scope_ref,switch_id`,
        [input.tenantId, input.destination],
      );
      await client.query("commit");
      return killState(result.rows.map((row) => ({
        active: Boolean(row.active),
        activatedAt: new Date(row.activated_at).toISOString(),
        deactivatedAt: row.deactivated_at ? new Date(row.deactivated_at).toISOString() : null,
        scopeRef: String(row.scope_ref),
        scopeType: row.scope_type as "DESTINATION" | "GLOBAL",
        switchId: String(row.switch_id),
      })));
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
