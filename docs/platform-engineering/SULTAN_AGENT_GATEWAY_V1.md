# Luzione Sultan Agent Gateway v1

Status: implemented and default-off for external effects. The repository contains no active RFQ policy envelope and local tests do not send email.

## Boundary

The gateway is the sole Luzione entry point for Sultan tools:

- `GET /api/v1/sultan/tools` returns the registry/capability intersection. Discovery is not authorization.
- `POST /api/v1/sultan/tool-invocations` executes an A0 read or reserves a policy-admitted command.
- `GET /api/v1/sultan/effects/{receiptId}/readback` returns tenant-scoped P110/provider state.

Every endpoint requires the exact signed Sultan workload. Actor, tenant, logical agent, capabilities, action risk, provider credentials, and effect policy are derived server-side. Legacy identity headers are ignored and the public tool-call parser rejects authority-shaped fields at any depth.

The initial authoritative tools are Commercial Case context and missing-evidence reads. Other Sultan registry tools remain invisible until they have a Luzione-owned implementation and admission contract.

## A2 RFQ canary

The only A2 action is `luzione.supplier_rfq_email.send`. Reservation requires all of the following inside the same P110 transaction:

- exact Revenue Steward and Commercial Case binding;
- exact current object version and fresh bound evidence;
- affirmed Independent Critic control evidence;
- recipient exactly `hello@ciflow.io`;
- one configured sender;
- subject beginning `[SULTAN RFQ CANARY]`;
- synthetic/allowlisted content class, no attachments, tracking links, URLs, confidential markers, additional email addresses, or phone-like personal data;
- active case-bound policy envelope with an expiry no later than 24 hours and a daily quota from 1 through 3;
- no active global, destination, or command kill switch.

The durable outbox permits one provider attempt. A transport or acknowledgement ambiguity enters reconciliation and is not automatically resent. Gmail messages include a stable RFC 822 Message-ID and operation header for authoritative search/readback. `PROVIDER_ACCEPTED` means Gmail accepted or contains the exact message record; `deliveryProven` remains false unless a separate delivery event exists.

## Activation

Activation is an external, reviewed operational decision—not part of schema deployment. It requires all of these independent conditions:

1. Deploy the API migration and provider worker candidate.
2. Configure the sender and an API-owned opaque tenant/provider/destination credential binding. The provider worker resolves credential material only after a fresh `luzione-effect-admission/v1` decision; no raw global Gmail-token environment variable is an authority path.
3. Enable the existing live-provider controls only for tenant `luzione` and destination `gmail.sultan-rfq-canary`.
4. Create one reviewed `public.sultan_agent_policy_envelopes` record bound to the exact synthetic case, steward/tool versions, sender, recipient, prefix, activation time, expiry, and daily maximum.
5. Enable Sultan's separate fixed-case canary gate.
6. Observe the P110 receipt and Gmail readback after each run. Do not infer delivery.

No migration seeds an envelope. General supplier or customer outreach remains blocked.

## Containment

Activate the existing P110 global/destination/command kill switch first. Pending, ambiguous, and reconciled messages must retain their original stable operation identity. Never create a replacement operation until the prior provider outcome is known and a separate human promotion authorizes a new canary.

## Verification

```text
npm test
npm run typecheck
npm run lint
npm run build
```

Provider tests use injected fetch adapters only; they make no live Gmail call.
