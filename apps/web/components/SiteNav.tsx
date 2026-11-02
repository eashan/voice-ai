import Link from "next/link";
import { CONTACT } from "../content/contact";
import { NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";

/** Shared top nav, ported from the Home artboard. */
export function SiteNav() {
  return (
    <div style={{ padding: "0 24px" }}>
      <nav
        aria-label="Primary"
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "20px 0",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <Link href="/" style={{ fontWeight: 800, fontSize: 18, textDecoration: "none", letterSpacing: "-0.02em" }}>
          eashan.kadam
        </Link>
        <NavLinks />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ThemeToggle />
          <a
            href={CONTACT.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 15,
              fontWeight: 500,
              textDecoration: "none",
              minHeight: 44,
              display: "inline-flex",
              alignItems: "center",
              padding: "0 8px",
            }}
          >
            Contact ↗
          </a>
        </div>
      </nav>
    </div>
  );
}
