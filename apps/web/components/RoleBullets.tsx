"use client";

import { useId, useState } from "react";

const SHOWN = 2;

/** First two bullets always visible; the rest behind "Show N more". */
export function RoleBullets({ bullets }: { bullets: string[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const hidden = bullets.length - SHOWN;
  const shown = open ? bullets : bullets.slice(0, SHOWN);

  return (
    <>
      <ul
        id={listId}
        style={{
          margin: 0,
          paddingLeft: 18,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontSize: 15,
          lineHeight: 1.55,
          color: "var(--body)",
        }}
      >
        {shown.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          className="mono"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={listId}
          style={{
            alignSelf: "flex-start",
            minHeight: 44,
            padding: 0,
            border: "none",
            background: "transparent",
            color: "var(--accent)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {open ? "Show less" : `Show ${hidden} more`}
        </button>
      )}
    </>
  );
}
