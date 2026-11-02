"use client";

/** Address parts: joined only on click, so the address never appears in the page's HTML. */
const PARTS = ["eashankadam", "gmail.com"] as const;

export function EmailButton({ style }: { style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = `mailto:${PARTS.join("@")}`;
      }}
      style={style}
    >
      Email me
    </button>
  );
}
