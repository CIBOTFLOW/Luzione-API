import Link from "next/link";
import { platformContractRegistry } from "@/modules/platform-contracts/registry";
import { performanceProfileRegistry } from "@/modules/platform-performance/program";
import { releaseEvidenceLaw } from "@/modules/platform-release/releaseContract";
import { securityControlRegistry } from "@/modules/platform-security-controls/registry";
import { serviceCatalog } from "@/modules/platform-service-catalog/registry";
import { sliRegistry, sloRegistry } from "@/modules/platform-slo/registry";
import { testTaxonomySummary } from "@/modules/platform-testing/taxonomy";

export default function EngineeringPortalPage() {
  const currentContracts = platformContractRegistry.filter((contract) => contract.currentRuntime);
  const pendingContracts = platformContractRegistry.filter((contract) => !contract.currentRuntime);
  const measuredProfiles = performanceProfileRegistry.filter((profile) => profile.evidenceState === "HARNESS_READY");
  const testSummary = testTaxonomySummary();

  return (
    <div className="page engineering-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Evidence-bound control surface</span>
          <h1>Engineering portal</h1>
          <p>Inspect API-owned contracts, services, SLOs, security invariants and release law without granting mutation authority or promoting local evidence.</p>
        </div>
        <span className="mode-badge">Read only</span>
      </header>

      <section aria-labelledby="engineering-summary">
        <div className="section-heading"><div><span className="section-kicker">Current registry</span><h2 id="engineering-summary">What this build publishes</h2></div></div>
        <div className="metric-grid">
          <article className="metric"><span>Current contracts</span><strong>{currentContracts.length}</strong><small>{pendingContracts.length} pending or specified records remain visibly separate</small></article>
          <article className="metric"><span>Services</span><strong>{serviceCatalog.length}</strong><small>No local build is presented as a production deployment</small></article>
          <article className="metric"><span>SLIs / SLOs</span><strong>{sliRegistry.length} / {sloRegistry.length}</strong><small>All current SLO targets are provisional</small></article>
          <article className="metric"><span>Security controls</span><strong>{securityControlRegistry.length}</strong><small>Zero tolerance · current evidence remains local</small></article>
        </div>
      </section>

      <section aria-labelledby="contracts-heading">
        <div className="section-heading">
          <div><span className="section-kicker">Contract explorer</span><h2 id="contracts-heading">Machine-readable ownership</h2><p>Current runtime contracts and pending changesets are never conflated.</p></div>
          <Link className="inline-link" href="/api/v1/catalog">Open JSON catalog →</Link>
        </div>
        <div className="table-card">
          <div className="table-row engineering-contract-row table-head"><span>Contract</span><span>Version</span><span>Maturity</span><span>Consumers</span></div>
          {platformContractRegistry.map((contract) => (
            <div className="table-row engineering-contract-row" key={`${contract.contractId}@${contract.version}`}>
              <strong>{contract.name}</strong><code>{contract.version}</code><span>{contract.maturity}</span><span>{contract.consumers.join(" · ")}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="evidence-heading">
        <div className="section-heading"><div><span className="section-kicker">Release and reliability</span><h2 id="evidence-heading">Evidence gates</h2></div></div>
        <div className="evidence-grid">
          <article className="registry-card">
            <h3>Release law</h3>
            <dl>
              <div><dt>Deployment acknowledgement</dt><dd>{releaseEvidenceLaw.deploymentAcknowledgementIsBusinessCompletion ? "Completion" : "Not completion"}</dd></div>
              <div><dt>Production finality</dt><dd>{releaseEvidenceLaw.productionFinalityRequiresProductionObservation ? "Requires observation" : "Unsupported"}</dd></div>
              <div><dt>Security failure</dt><dd>{releaseEvidenceLaw.securityFailuresAreZeroTolerance ? "Blocks" : "Unknown"}</dd></div>
            </dl>
          </article>
          <article className="registry-card">
            <h3>Test evidence classes</h3>
            <dl>{testSummary.map((item) => <div key={item.testClass}><dt>{item.testClass}</dt><dd>{item.primarySuiteCount}</dd></div>)}</dl>
            <p>Zero means unproven, not not-applicable.</p>
          </article>
          <article className="registry-card">
            <h3>Local performance harness</h3>
            <dl>{measuredProfiles.map((profile) => <div key={profile.profileId}><dt>{profile.campaign}</dt><dd>{profile.requests} GETs · c{profile.concurrency}</dd></div>)}</dl>
            <p>{performanceProfileRegistry.length - measuredProfiles.length} campaigns remain contract-only.</p>
          </article>
          <article className="registry-card">
            <h3>Operational readbacks</h3>
            <nav className="evidence-links" aria-label="Operational evidence endpoints">
              <Link href="/api/v1/livez">Liveness</Link>
              <Link href="/api/v1/readyz">Dependency readiness</Link>
              <Link href="/api/v1/healthz">Security readiness</Link>
              <Link href="/api/v1/catalog">Contract catalog</Link>
            </nav>
          </article>
        </div>
      </section>

      <section aria-labelledby="services-heading">
        <div className="section-heading"><div><span className="section-kicker">Service ownership</span><h2 id="services-heading">Deployables and truth scope</h2></div></div>
        <div className="evidence-grid">
          {serviceCatalog.map((service) => (
            <article className="registry-card" key={service.serviceId}>
              <span className="quiet-label">{service.criticalityTier} · {service.serviceId}</span>
              <h3>{service.name}</h3>
              <p>{service.sourceOfTruthScope.join(" · ")}</p>
              <small>Observed production SHA: {service.lastObservedReleaseSha ?? "not observed"}</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
