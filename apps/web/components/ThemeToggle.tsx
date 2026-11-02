"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

function effectiveTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** 44px theme switch from the Home artboard nav. Defaults to the OS preference until the visitor picks one. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null); // null until mounted: server can't know the theme

  useEffect(() => {
    setTheme(effectiveTheme());
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      if (!storedTheme()) setTheme(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function flip() {
    const next: Theme = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage blocked: the choice lasts for this page view only
    }
    setTheme(next);
  }

  const label = theme === "dark" ? "Switch to light mode" : theme === "light" ? "Switch to dark mode" : "Toggle theme";

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={label}
      title={label}
      style={{
        width: 44,
        height: 44,
        borderRadius: 12,
        border: "1px solid var(--line)",
        background: "transparent",
        color: "var(--ink)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ visibility: theme ? "visible" : "hidden" }}
      >
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        )}
      </svg>
    </button>
  );
}
