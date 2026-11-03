# Portfolio site on VoiceForge: plan

Date: 2026-11-02 (rev 2) · Builds on `docs/M0_PLAN.md` and the live M0 deploy (`docs/DEPLOY.md`).
Status: **plan + design locked for build. No app code changed yet.** Implementation happens in Claude Code, iterating on this doc.
Design canvas: "Portfolio Hero Directions". It holds the chosen design: Home light, Home dark, Playground, Experience.
Assets: `docs/portfolio-assets/` (headshot crop 900×900, original photo, résumé PDF).

## Decisions

| # | Area | Decision |
|---|---|---|
| 1 | Codebase | Extend `apps/web` into the portfolio. The orchestrator stays the single voice backend on Fly `iad`. |
| 2 | Access | **Concierge open** (no invite code). **Demos + playground gated** behind the invite code you hand to serious leads. |
| 3 | Look | **B's typography + C's circular photo with the voice waveform ring + C's per-turn latency chips. Light and dark themes**, toggle in nav. |
| 4 | Build | Executed by Eashan in Claude Code. This doc is the brief; change it as the architecture evolves. |

## Design spec

### Type
- Display / UI: **Inter Tight**. 800 for the name and headings, letter-spacing −0.03 to −0.055em. 400–600 for body and UI.
- Labels, nav numbers, metrics, code: **JetBrains Mono**, 12–13px.
- Name: `clamp(64px, 11vw, 160px)`, line-height 0.88, one line.

### Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FFFFFF` | `#0A0F1C` | page |
| `surface` | `#F6F7FA` | `#101830` | cards, chips |
| `ink` | `#0A0A0A` | `#E7ECF5` | headings, primary text |
| `body` | `#4A4A4A` | `#B4BED0` | paragraphs |
| `muted` | `#5C5C5C` | `#8F9BB3` | captions, labels |
| `line` | `#E6E6E6` | `#22304D` | borders |
| `strong` | `#0A0A0A` | `#E7ECF5` | rule above the highlights strip |
| `accent` | `#2346FF` | `#7C93FF` | voice CTA, live waveform, latency values |
| `accentInk` | `#FFFFFF` | `#0A0F1C` | text on accent |
| `ringIdle` | `#D5D9E3` | `#2C3B5E` | waveform bars at rest |
| `ok` | `#12A150` | `#3DD68C` | "ready" dots |
| `accentSoft` | `#F2F4FF` | `#181F37` | metric pill fill |
| `accentLine` | `#C9D2FF` | `#323D6B` | metric pill border |
| `track` | `#AEB8CF` | `#4A5F94` | muted waterfall bars |
| `surface2` | `#ECEEF4` | `#16203A` | playground orb centre |
| `danger` | `#D12C2C` | `#FF8A8A` | over the char cap, errors |

Default to `prefers-color-scheme`. Remember a manual toggle in `localStorage`, wrapped in try/catch.
Implemented in `apps/web/app/globals.css` as kebab-case CSS variables (`--accent-soft`, …); components use `var(--token)` in inline styles.

### Components
- **VoiceOrb (hero):** 280px box; circular photo 188px with a 3px `bg` border; 48 radial bars, 2px wide, every 7.5°.
  - Idle: 10px bars in `ringIdle`.
  - Live: bar heights 14–40px in `accent`.
  - **Build it for real:** drive bar heights from audio RMS through an `AnalyserNode` on the playback stream (agent speaking) and the mic (user speaking). The canvas uses a fake CSS pulse.
- **Voice CTA:** pill, 56px tall.
  - Idle: `accent` fill, label "Talk to my AI about me".
  - Live: outline, label "Listening… tap to hang up".
  - "Email me" secondary pill beside it.
- **LatencyChips:** 4 mono chips under the CTA, showing "—" until the first turn completes. Map to the existing `LatencyStage` events in `packages/shared/src/latency.ts`:
  - `endpoint` = endpoint − speech_end
  - `stt` = stt_final − endpoint
  - `llm_ttft` = llm_first_token − llm_request
  - `tts` = tts_first_byte − tts_first_send
  - Caption: "last turn · server clock". Already sent per turn as `stage` / `turn_complete` messages.
- **LatencyWaterfall (playground):** one bar per stage, offset from `speech_end`, plus `chunker` (tts_first_send − llm_first_token). Total = `serverV2vMs`. `llm_ttft` in `accent`; the other stages muted.
- **Highlights strip:** 4 numbers, all from the résumé: ~$1M ARR, $450K, +25%, 80%.
- **Demo cards:** mono id + "ready" status (from `/healthz`: `ready`, `busy`, `resting`), title, one-liner, **Call the agent**, **View prompt** (opens the playground with that agent).
- **Experience:** timeline rows. Left column: dates, company, one metric pill. Right column: title and the first 2 bullets, with "Show N more". Below: education, achievements, skills cards. Copy is verbatim from the résumé.

## Information architecture

| Route | What's on it |
|---|---|
| `/` | VoiceOrb + name + pitch + voice CTA + latency chips. Highlights strip. 3 demo cards. Demos use fictional companies; "Best with headphones" note. |
| `/playground` | Agent tabs (Debt collection, Insurance support, Roofing support, Portfolio concierge). Locked safety-rules notice. Editable `system_prompt` with a char counter (4,000 cap). Reset to default; Start call. Right side: orb, transcript, waterfall. Invite-gated. |
| `/experience` | Separate tab, static (RSC). Résumé PDF download. |

The demo cards on `/` start the call inline. No separate `/demos` page; it's one fewer route and keeps the demos above the fold on desktop.

**Single source of truth:** put the profile in `apps/web/content/profile.ts`, structured as roles, bullets, metrics, skills, education and achievements, and seed it from the résumé PDF. `/experience` renders it, and a script generates the knowledge section of `portfolio-concierge.prompt.md` from it.
- The prompt's current knowledge already differs from the résumé in wording and detail. Example: the résumé's Citicorp entry is one bullet; the prompt has three.
- **Decided (step 2):** the résumé is canonical for everything shown on the page (`bullets`, verbatim, strongest two first; all bullets shown behind "Show N more"). True facts that exist only in the old prompt live in per-role `concierge` lists plus top-level `projects` / `conciergeSkills`, used only by the prompt generator.

## Orchestrator changes

Today the orchestrator loads **one agent at boot** (`index.ts`: `const agent = loadAgent()`), and the `Gate` rejects any token whose `aid` isn't the concierge. `Session` already takes the agent per session, so the change is small.

1. **Agent registry.** Load every `*.json` in `apps/orchestrator/agents/` into `Map<agentId, AgentConfig>`. New agents:
   - `debt-collection`
   - `insurance-support`
   - `roofing-support`
   Each gets its own Aura voice, greeting and `keyterms`.
2. **Gate checks against the registry.** `claims.aid` must be a known agent. Add a `tier` claim (`public` | `invited`).
3. **Sandbox prompt override.**
   - `POST /api/session` accepts `{ agentId, code?, prompt? }`.
   - With a prompt: check the invite code, cap at ≤ 4,000 chars, then sign `ph = sha256(prompt)` into the JWT.
   - The client sends `{ type: "start", token, prompt }`. The orchestrator re-hashes and rejects a mismatch, then clones the base agent with `systemPrompt` replaced.
4. **Locked guard.** `buildSystemPrompt` = `SANDBOX_GUARD` + user prompt + `VOICE_STYLE_BLOCK`.
   - Guard rules: fictional company and customers; never request or accept real card, bank or ID numbers; no threats or harassment; stay a customer-service agent.
   - Cost: no cross-session cache for sandbox prompts.
5. **Protocol.** `start` gains optional `prompt`. `ready` gains `agentId`.
6. **Budgets.** Split `DAILY_MINUTE_BUDGET` into `PUBLIC_MINUTES` and `INVITED_MINUTES`, and reserve one concurrent slot for `invited`.

## Web changes

- Extract `page.tsx` (298 lines) into a reusable `<VoiceCall agentId prompt?>` component that exposes state, audio levels (for the orb) and latency events.
- **Concierge with no code:** Cloudflare Turnstile on `/api/session` for the concierge. The current per-IP limiter is per serverless instance, so it isn't a real limit. Use Upstash/Vercel KV, or rely on the Fly-side budget.
- Invite unlock: an httpOnly cookie after one successful code check.
- Pre-warm Fly: `fetch('/healthz')` on page load (cold boot is about 10 s).
- Graceful states for `busy`, `budget_exhausted` and `disabled`: "Agent is resting", with a recorded sample call. Never show a dead button.

## Demo agent briefs

Draft prompts are on the Playground artboard. The company names are fictional placeholders; change them freely.

| Agent | Persona & goal | Must-haves | Show-off moment |
|---|---|---|---|
| Debt collection: "Riya", Brightline Finance | Overdue personal-loan EMI → promise-to-pay or a ≤3-instalment plan. | Date-of-birth check before discussing the debt; "this is an attempt to collect a debt"; dispute path; no threats; payment only by a later secure link. | Barge-in mid-negotiation; instalment dates read back correctly. |
| Insurance support: "Sam", Harbor Mutual | Policy questions, FNOL intake, renewal callback. | Fake policy lookup; never promise claim approval. | FNOL summary read back at the end. |
| Roofing support: "Jo", Summit Roofing | After-hours line: qualify, then book an inspection. | Homeowner? Damage type? Leaking now? Insurance claim? | "Water is coming in right now" → urgent path first. |

M1 hook: tool calls (`lookup_policy`, `book_slot`, `create_payment_plan`) via the PRD's HTTP tools.

## Risks (blunt)

1. **False claim on the live site.** The concierge prompt says "sub-second" twice: the how-it-works line and the VoiceForge project line. Measured server V2V from `iad` is **1.15–1.44 s**, before network. Fix it before sharing the URL. The design shows the real per-stage numbers instead of a headline claim. That only works if the numbers stay honest, so the design's 1,220 ms sample is close to the measured median.
2. **Your phone number is on the résumé PDF.** Served as a public download, it gets scraped. The concierge is told never to share a phone number, and the PDF would undo that. Ship a web copy without the phone line.
3. **The photo.** The crop works. The original has a Catan box, an Instagram logo and a racket in frame, so never use it uncropped. A clean headshot would beat this one at large sizes, because the crop comes from about a third of the frame.
4. **Concurrency = 2** and one shared minute pool: see Budgets.
5. **The sandbox is a jailbreak toy.** Mitigations: guard block, invite gate, length cap, and logging prompts (first 200 chars + hash) to `/data`. Keep it gated.
6. **Debt collection optics.** Keep it obviously fictional, with disclosure first. Fintech reviewers will look for compliance instincts.
7. **Echo without headphones:** a known M0 limit. The note on the demo cards covers it.

## Build order (≈1.5–2 weeks, part-time)

1. Tokens + fonts + theme toggle (`globals.css` CSS variables for both themes).
2. `content/profile.ts` from the résumé → `/experience` (static, ships independently).
3. `<VoiceCall>` extraction → home hero with VoiceOrb (real audio levels) + LatencyChips + **highlights strip** (was missing from the build order) → Turnstile + open concierge → fix the "sub-second" copy.
4. Orchestrator: registry, Gate by registry, tier claim, split budgets. Deploy.
5. Three demo agents (configs + prompts) → demo cards with invite cookie + "resting" fallbacks.
6. Playground: prompt hash in the JWT, guard block, prompt logging, editor UI + waterfall.
7. Phone-width pass, Lighthouse, OG image/meta, custom domain → update `ALLOWED_ORIGINS`.

## Handoff to Claude Code

- Point it at this file, `docs/M0_PLAN.md` and `PRD_Voice_Agent_Builder.md` first.
- Design source: `docs/portfolio-design/` (artboards exported as source, with a README on how to read them). Port the markup and inline styles from there; don't recreate them from screenshots. Tokens and component specs above are canonical where the canvas and this doc differ. Re-export if the canvas changes.
- `docs/DEPLOY.md` has uncommitted local changes that predate this plan. Commit or stash them before branching.

## Step 3 decisions (2026-11-03)

- **Concierge access:** Cloudflare Turnstile (`appearance: interaction-only`) checked by `/api/session`. Until both
  `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set, the hero shows an invite-code field instead.
- **"Email me":** kept; the address is assembled on click and never appears in the HTML. Nav "Contact" → LinkedIn.
- **Transcript:** a floating panel on the right during a call, max 2 turns, oldest slides up under a fade, lingers 4 s
  after the call. **Hidden below 900px**: phones get no transcript.
- **Latency:** concierge on `claude-haiku-4-5` (no `effort` param; no prompt cache: under its 4,096-token minimum) and
  `silenceMs` 200. `effort` is now optional in the agent schema.
- **Prompt:** `portfolio-concierge.prompt.md` is generated: `npx tsx scripts/gen-concierge-prompt.ts` (rules in
  `portfolio-concierge.template.md`, knowledge from `apps/web/content/profile.ts`; `--check` to verify). The
  "sub-second" claim is gone; the agent never quotes a response time.
- **Measured after the switch** (Fly `iad`, 16 turns, server clock): V2V p50 **1,114 ms** (was 1,151–1,438); endpointing
  p50 212, STT finalize 85, LLM TTFT p50 **384** (was ~540; one 1,637 outlier), chunker wait p50 **211**, TTS first
  byte 126, first audible out 78. Still above the 700 ms bar; the next lever is the chunker wait (first chunk sooner).
- **Availability:** `/api/status` proxies the orchestrator's `/healthz` (also the Fly pre-warm) → `ready | busy | resting`.

## Step 4 decisions (2026-11-03)

- **Registry:** every `apps/orchestrator/agents/*.json` is loaded at boot (`loadAgents()`); TTS provider chosen per agent.
- **Access:** each agent declares `"access": "public" | "invited"` (default `invited`). The concierge is `public`.
- **Tier claim:** `/api/session` signs `tier` from the proof: Turnstile → `public`, invite code → `invited`. Tokens
  without a tier count as `public`. The Gate checks: known agent, matching workspace, access vs tier, slot, budget.
- **Limits:** 2 concurrent calls; public callers hold at most 1 (`RESERVED_INVITED_SLOTS=1`). `PUBLIC_MINUTES=40`,
  `INVITED_MINUTES=20` per UTC day, tracked separately in `/data/usage.json`. `/healthz` reports both tiers.
- Until the Turnstile keys are set, concierge callers use the invite code, so they count as `invited`.
- Tests: `npx tsx scripts/test-gate.ts` (23 checks).

## What you need to do yourself

- [x] Pick a direction: B + C, light and dark.
- [x] Photo and résumé: in `docs/portfolio-assets/`.
- [ ] Decide on a phone-free web résumé PDF.
- [ ] Confirm or rename the fictional companies (Brightline Finance, Harbor Mutual, Summit Roofing) and personas.
- [ ] Pick 3 Deepgram Aura voices.
- [ ] Cloudflare Turnstile site key + secret.
- [ ] Custom domain (if any).
- [ ] Optional: record one good call per demo agent for the "resting" fallback.
- [ ] Optional: a clean headshot (plain background, shoulders up).
