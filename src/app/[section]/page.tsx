import { notFound } from "next/navigation";
import { canonicalObjects, platformAreas } from "@/lib/platformCatalog";

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const area = platformAreas.find((item) => item.id === section);
  if (!area) notFound();
  const items = area.id === "objects" ? canonicalObjects.map((item) => ({ title: item.name, subtitle: item.owner, detail: item.next })) : area.owns.map((item) => ({ title: item, subtitle: area.label, detail: "Canonical contract and operational projection" }));

  return (
    <div className="page">
      <header className="page-header">
        <div><span className="eyebrow">API platform</span><h1>{area.label}</h1><p>{area.summary}</p></div>
        <span className={`mode-badge state-${area.status}`}>{area.status}</span>
      </header>
      <section className="section-heading"><div><h2>Owned contracts</h2><p>These records are deterministic authority, not Sultan memory or recommendations.</p></div></section>
      <div className="table-card">
        <div className="table-row table-head"><span>Contract</span><span>Area</span><span>Responsibility</span></div>
        {items.map((item) => <div className="table-row" key={item.title}><strong>{item.title}</strong><span>{item.subtitle}</span><span>{item.detail}</span></div>)}
      </div>
      <section className="contract-card">
        <h2>Current API surface</h2>
        {area.apiRoutes.length ? area.apiRoutes.map((route) => <code key={route}>{route}</code>) : <p>No endpoint is activated yet. The console records the target boundary without implying production capability.</p>}
      </section>
    </div>
  );
}
