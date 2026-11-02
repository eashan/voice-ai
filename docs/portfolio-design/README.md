# Portfolio design source (exported from the "Portfolio Hero Directions" canvas, 2026-11-03)

These are the design artboards, exported as source. They are **specs to implement in Next.js**, not files to serve.

| File | Screen |
|---|---|
| `Home.dc.html` | Home, light. Contains the theme tokens for **both** themes (see `renderVals()` → `t`). |
| `HomeDark.dc.html` | Home, dark: just mounts `Home` with `dark=true`. |
| `Playground.dc.html` | Agent playground (dark): prompt editor, call panel, latency waterfall, draft demo prompts. |
| `Experience.dc.html` | Experience tab (light): résumé content, verbatim. |

## How to read the format
- Markup inside `<x-dc>` is the layout; inline `style` attributes are the real CSS values.
- `{{ name }}` holes are filled from `renderVals()` in the `<script type="text/x-dc">` block at the bottom: that's where the theme tokens, sample data, demo copy and draft prompts live.
- `<sc-for list=… as=…>` = a `.map()`, `<sc-if value=…>` = a conditional.
- `onClick="{{ fn }}"` and `this.setState` = mock interactivity (theme toggle, call on/off). Real behaviour is specced in `../PORTFOLIO_PLAN.md`.
- `support.js`, `DCLogic` and `hint-*` attributes belong to the design tool's runtime: ignore them.
- The photo points at `../portfolio-assets/eashan-headshot.jpg`.

## Canonical sources
Tokens, component behaviour and the build order live in `../PORTFOLIO_PLAN.md`. If this markup and the plan disagree, the plan wins.
The waveform ring and latency numbers here are **fake animations / sample values**: wire them to real audio levels and `turn_complete` events.
