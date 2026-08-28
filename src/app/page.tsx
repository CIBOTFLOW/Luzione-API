import Link from "next/link";
import { runtimeConfig } from "@/lib/api/config";
import { platformAreas } from "@/lib/platformCatalog";
import { readRlsReadiness } from "@/lib/security-posture/readService";

export const dynamic = "force-dynamic";

const endpointCatalog = [
  {
    method: "GET",
    path: "/api/v1/healthz",
    access: "Public aggregate",
    purpose: "Deployment, configuration, and RLS readiness without sensitive detail.",
    linked: true,
  },
  {
    method: "GET",
    path: "/api/v1/sultan/runtime-status",
    access: "Public aggregate",
    purpose: "Live cognition, learning, model routing, connector, Shopify, and proposal evidence.",
    linked: true,
  },
  {
    method: "GET",
    path: "/api/v1/catalog",
    access: "Public contract",
    purpose: "Canonical objects, ownership boundaries, and active platform areas.",
    linked: true,
  },
  {
    method: "GET · POST",
    path: "/api/v1/catalog/shopify/projections",
    access: "Service authenticated",
    purpose: "Read or atomically reconcile the tenant-scoped P113 quote catalog projection.",
    linked: false,
  },
  {
    method: "GET",
    path: "/api/v1/platform-guarantees",
    access: "Service authenticated",
    purpose: "Command, event, workflow, retry, and recovery guarantees.",
    linked: false,
  },
  {
    method: "GET",
    path: "/api/v1/security/rls-readiness",
    access: "Service authenticated",
    purpose: "Detailed RLS readback and optional active denial probes.",
    linked: false,
  },
  {
    method: "GET",
    path: "/api/v1/autonomy/constitution",
    access: "Service authenticated",
    purpose: "Versioned effect classes, immutable guardrails, and registered capability policy.",
    linked: false,
  },
  {
    method: "POST",
    path: "/api/v1/autonomy/evaluate",
    access: "Service authenticated · no effect",
    purpose: "Fail-closed action-plan evaluation; client authority claims are rejected.",
    linked: false,
  },
] as const;

async function readControlPlaneStatus() {
  const config = runtimeConfig();
  let security: Awaited<ReturnType<typeof readRlsReadiness>> | null = null;

  if (config.databaseConfigured) {
    try {
      security = await readRlsReadiness();
    } catch {
      // The public console fails closed and exposes no database error detail.
    }
  }

  const ready = Boolean(
    config.databaseConfigured
      && config.serviceTokenConfigured
      && config.continuationSecretConfigured
      && security?.status === "PASS",
  );

  return {
    config,
    ready,
    security,
    statusLabel: ready
      ? config.internalProjectionsEnabled
        ? "Ready · bounded projections"
        : "Ready · read only"
      : "Configuration required",
  };
}

export default async function Home() {
  const status = await readControlPlaneStatus();
  const observed = status.security?.observedTableCount ?? 0;
  const expected = status.security?.expectedTableCount ?? 10;
  const violations = status.security?.violations.length ?? 1;

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Luzione control plane</span>
          <h1>One platform. Three clear places to work.</h1>
          <p>
            Luzione App handles human work, this API enforces business rules, and Sultan OS
            observes, evaluates, and improves the intelligence layer.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="https://app.luzione.com">
              Open Luzione App <span aria-hidden="true">↗</span>
            </Link>
            <Link className="button button-secondary" href="https://os.luzione.com">
              Open Sultan OS <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
        <div className={`readiness-panel ${status.ready ? "is-ready" : "is-blocked"}`}>
          <div className="readiness-title">
            <span className="status-dot" aria-hidden="true" />
            <span>{status.statusLabel}</span>
          </div>
          <strong>{status.ready ? "Safe foundation online" : "Fail-closed safety active"}</strong>
          <p>
            {status.ready
              ? status.config.internalProjectionsEnabled
                ? "Canonical Postgres is connected, RLS passes, and the P113 catalog projection can reconcile without external effects."
                : "Canonical Postgres is connected, the RLS gate passes, and mutations remain locked."
              : "The API is withholding authority until its database, authentication, signing, and RLS checks pass."}
          </p>
          <Link className="inline-link" href="/api/v1/healthz">
            View machine-readable health →
          </Link>
        </div>
      </header>

      <section aria-labelledby="live-posture-title">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Live posture</span>
            <h2 id="live-posture-title">What is verified now</h2>
          </div>
          <span className="quiet-label">Server-side database readback</span>
        </div>
        <div className="metric-grid">
          <article className="metric">
            <span>RLS-sensitive tables</span>
            <strong>{observed}/{expected}</strong>
            <small>{status.security?.status === "PASS" ? "Verified and protected" : "Readback unavailable or incomplete"}</small>
          </article>
          <article className="metric">
            <span>Security violations</span>
            <strong>{violations}</strong>
            <small>{violations === 0 ? "No current gate violations" : "Authority remains withheld"}</small>
          </article>
          <article className="metric">
            <span>Service identity</span>
            <strong>{status.config.serviceTokenConfigured ? "Ready" : "Missing"}</strong>
            <small>App and OS must authenticate as bounded service actors</small>
          </article>
          <article className="metric">
            <span>Internal projections</span>
            <strong>{status.config.internalProjectionsEnabled ? "Active" : "Locked"}</strong>
            <small>{status.config.internalProjectionsEnabled ? "P113 only · idempotent · no external effects" : "Projection writes fail closed"}</small>
          </article>
        </div>
      </section>

      <section aria-labelledby="planes-title">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Connected surfaces</span>
            <h2 id="planes-title">Where each kind of work belongs</h2>
          </div>
        </div>
        <div className="plane-grid">
          <Link className="plane-card" href="https://app.luzione.com">
            <div className="plane-number">01</div>
            <div>
              <span className="plane-role">Work</span>
              <h3>Luzione App</h3>
              <p>People, pipeline, commercial cases, proposals, tasks, approvals, orders, and customer care.</p>
              <small>Human-readable operating plane →</small>
            </div>
          </Link>
          <div className="connection-arrow" aria-hidden="true">→</div>
          <Link className="plane-card plane-card-current" href="/">
            <div className="plane-number">02</div>
            <div>
              <span className="plane-role">Rules</span>
              <h3>Luzione API</h3>
              <p>Identity, policy, canonical objects, commands, events, workflows, reliability, and audit.</p>
              <small>Deterministic authority boundary · current</small>
            </div>
          </Link>
          <div className="connection-arrow" aria-hidden="true">↔</div>
          <Link className="plane-card" href="https://os.luzione.com">
            <div className="plane-number">03</div>
            <div>
              <span className="plane-role">Observe</span>
              <h3>Sultan OS</h3>
              <p>Runs, tools, model routing, evaluations, evidence, learning, memory, simulations, and feedback.</p>
              <small>Machine and operator plane →</small>
            </div>
          </Link>
        </div>
      </section>

      <section className="flow-section" aria-labelledby="flow-title">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Governed flow</span>
            <h2 id="flow-title">How Sultan crosses the boundary</h2>
          </div>
          <span className="mode-badge">External effects off</span>
        </div>
        <ol className="flow-grid">
          <li><span>1</span><strong>Read</strong><p>Retrieve only tenant-authorized records and source evidence.</p></li>
          <li><span>2</span><strong>Recommend</strong><p>Sultan produces a typed proposal, citation, and confidence record.</p></li>
          <li><span>3</span><strong>Approve</strong><p>A person or policy supplies explicit authority for the bounded action.</p></li>
          <li><span>4</span><strong>Execute + verify</strong><p>The API applies an idempotent command, records a receipt, and reads the result back.</p></li>
        </ol>
        <p className="flow-note">
          Steps 1–2 are the active foundation. A bounded form of step 4 is active for the internal
          P113 catalog projection; customer sends, Shopify writes, payments, and other external effects remain locked.
        </p>
      </section>

      <section aria-labelledby="contract-title">
        <div className="section-heading">
          <div>
            <span className="section-kicker">API contract</span>
            <h2 id="contract-title">Available surfaces</h2>
          </div>
          <Link className="inline-link" href="/docs">Explore platform areas →</Link>
        </div>
        <div className="endpoint-table">
          <div className="endpoint-row endpoint-head">
            <span>Method</span><span>Path</span><span>Access</span><span>Purpose</span>
          </div>
          {endpointCatalog.map((endpoint) => (
            <div className="endpoint-row" key={endpoint.path}>
              <span className="method">{endpoint.method}</span>
              <span className="endpoint-path">
                {endpoint.linked ? <Link href={endpoint.path}>{endpoint.path}</Link> : <code>{endpoint.path}</code>}
              </span>
              <span>{endpoint.access}</span>
              <span>{endpoint.purpose}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="areas-title">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Build map</span>
            <h2 id="areas-title">Authority areas</h2>
            <p>Foundation means the contract exists; it does not imply production write authority.</p>
          </div>
        </div>
        <div className="area-grid">
          {platformAreas.map((area) => (
            <Link className="area-card" href={`/${area.id}`} key={area.id}>
              <div className="card-top"><h3>{area.label}</h3><span className={`state state-${area.status}`}>{area.status}</span></div>
              <p>{area.summary}</p>
              <small>{area.owns.slice(0, 4).join(" · ")}</small>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
