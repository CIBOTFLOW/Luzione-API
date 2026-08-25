import Link from "next/link";
import type { ReactNode } from "react";
import { platformAreas } from "@/lib/platformCatalog";

export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Luzione API home">
          <span className="brand-mark">L</span>
          <span><strong>Luzione</strong><small>API Platform</small></span>
        </Link>
        <nav aria-label="Platform sections">
          <Link href="/" className="nav-link">Overview</Link>
          {platformAreas.map((area) => (
            <Link key={area.id} href={`/${area.id}`} className="nav-link">{area.label}</Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" />
          <div><strong>Safe foundation</strong><small>Mutations fail closed</small></div>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
