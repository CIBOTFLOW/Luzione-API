import Link from "next/link";
import { runtimeConfig } from "@/lib/api/config";
import { platformAreas } from "@/lib/platformCatalog";

export const dynamic = "force-dynamic";

export default function Home() {
  const config = runtimeConfig();
  const configured = [config.databaseConfigured, config.serviceTokenConfigured, config.continuationSecretConfigured].filter(Boolean).length;
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Deterministic business platform</span>
          <h1>Luzione API</h1>
          <p>The authority layer between Luzione UI, Sultan OS, canonical data and approved providers.</p>
        </div>
        <span className="mode-badge">{config.mutationsEnabled ? "Controlled mutations enabled" : "Read-only foundation"}</span>
      </header>

      <section className="metric-grid" aria-label="Platform status">
        <article className="metric"><span>Configuration</span><strong>{configured}/3</strong><small>database, service auth, continuation signing</small></article>
        <article className="metric"><span>Contract</span><strong>v1.0</strong><small>P110 command/event and P111 workflow foundation</small></article>
        <article className="metric"><span>External effects</span><strong>Off</strong><small>No provider mutation authorized by this release</small></article>
        <article className="metric"><span>Authority</span><strong>API</strong><small>Sultan recommends; API validates and executes</small></article>
      </section>

      <section className="section-heading">
        <div><h2>Platform areas</h2><p>Each area has one deterministic responsibility and one canonical home.</p></div>
        <Link className="text-link" href="/docs">View developer contract →</Link>
      </section>
      <div className="area-grid">
        {platformAreas.map((area) => (
          <Link className="area-card" href={`/${area.id}`} key={area.id}>
            <div className="card-top"><h3>{area.label}</h3><span className={`state state-${area.status}`}>{area.status}</span></div>
            <p>{area.summary}</p>
            <small>{area.owns.slice(0, 4).join(" · ")}</small>
          </Link>
        ))}
      </div>

      <section className="boundary-card">
        <div><span>Human work</span><strong>app.luzione.com</strong><p>Records, queues, documents, approvals and business-language outcomes.</p></div>
        <b>→</b>
        <div className="boundary-focus"><span>Deterministic authority</span><strong>api.luzione.com</strong><p>Identity, commands, events, workflows, integrations, reliability and audit.</p></div>
        <b>←</b>
        <div><span>Intelligence</span><strong>os.luzione.com</strong><p>Agents, models, memory, reasoning, simulations and AI governance.</p></div>
      </section>
    </div>
  );
}
