import Link from "next/link";
import type { ReactNode } from "react";
import { platformAreas } from "@/lib/platformCatalog";

const platformPlanes = [
  { label: "Work", detail: "App", href: "https://app.luzione.com", current: false },
  { label: "Rules", detail: "API", href: "/", current: true },
  { label: "Observe", detail: "OS", href: "https://os.luzione.com", current: false },
] as const;

export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Luzione API control plane home">
          <span className="brand-mark">L</span>
          <span><strong>Luzione</strong><small>Control plane</small></span>
        </Link>

        <nav className="plane-switcher" aria-label="Luzione platform surfaces">
          {platformPlanes.map((plane) => (
            <Link
              key={plane.label}
              href={plane.href}
              aria-current={plane.current ? "page" : undefined}
              className={`plane-link ${plane.current ? "plane-link-current" : ""}`}
            >
              <span>{plane.label}</span>
              <small>{plane.detail}</small>
            </Link>
          ))}
        </nav>

        <div className="nav-divider" />
        <p className="nav-label">API areas</p>
        <nav className="section-nav" aria-label="API platform areas">
          <Link href="/" className="nav-link">Overview</Link>
          {platformAreas.map((area) => (
            <Link key={area.id} href={`/${area.id}`} className="nav-link">{area.label}</Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" aria-hidden="true" />
          <div><strong>Safe foundation</strong><small>RLS verified · P113 bounded</small></div>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
