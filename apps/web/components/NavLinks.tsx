"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "01 Demos" },
  { href: "/playground", label: "02 Playground" },
  { href: "/experience", label: "03 Experience" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <div className="mono" style={{ display: "flex", flexWrap: "wrap", gap: 28, fontSize: 13 }}>
      {NAV.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            style={{
              textDecoration: "none",
              minHeight: 44,
              display: "inline-flex",
              alignItems: "center",
              color: active ? "var(--ink)" : "var(--body)",
              boxShadow: active ? "inset 0 -2px 0 var(--accent)" : undefined,
            }}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
