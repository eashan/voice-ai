# VoiceForge — M0 Plan (Latency Spike + Demo)

Date: 2026-11-02 · Source PRD: `../PRD_Voice_Agent_Builder.md` (§7, §13 M0)

## Goal
Prove the streaming pipeline **ElevenLabs STT → Claude Haiku 5.5 → Deepgram Aura TTS** can hold sub-second
voice-to-voice latency, and ship a public, gated demo page that shows it per turn.

**Exit criterion:** server-measured V2V **p50 ≤ 700 ms** over ~50 manual turns (leaves ~100 ms headroom for
network + browser playout, so real end-to-end ≈ the PRD's 800 ms target).

## Decisions

| # | Area | Decision | Seam kept for later |
|---|---|---|---|
| 1 | Scope | M0 latency spike + demo page (talk button, latency waterfall). One hardcoded agent config in JSON. | Config shape already has `workspaceId`, `agentId`, `version` → Postgres in M1 |
| 2 | Runtime | TypeScript on Node. npm-workspaces monorepo: `apps/web` (Next.js), `apps/orchestrator`, `packages/shared`. | Orchestrator is a separate service (data plane) — rewritable in Go if needed |
| 3 | Transport | WebSocket, raw PCM frames. | `Transport` interface declares its `AudioFormat`; Twilio Media Streams (μ-law 8 kHz) becomes a second implementation. LiveKit/WebRTC later |
| 4 | Endpointing | Step A: ElevenLabs Scribe realtime built-in VAD commit. Step B (within M0): own Silero VAD (onnxruntime-node). | `Endpointer` interface; semantic turn detection (v1.1) swaps in |
| 5 | Hosting | Orchestrator: one Fly.io container in `iad` (US-East). Web: Vercel. Validate region with a TTFB probe in week 1. | Docker image → ECS later |
| 6 | Cost gating | Invite code → Next.js API issues short-lived JWT (60 s to connect) → orchestrator rejects WS without it. Caps: 3-min calls, 20 s silence hangup, 2 concurrent, daily minute budget, `DEMO_ENABLED` kill switch. Provider-console spend limits as backstop. | JWT later carries real `workspaceId`/`agentId` from auth |
| 7 | Demo agent | "Ask me about Eashan" portfolio concierge; stays strictly on topic, declines everything else. | M1 adds HTTP tool `request_intro` (tool call + filler audio demo) |
| 8 | Measurement | Server-only stage timestamps (one monotonic clock), labelled **"server V2V"**. Each turn → one JSONL line; `scripts/latency-report` prints p50/p95 per stage. | Event shape (`sessionId`, `turnId`, `stage`, `t`) loads into ClickHouse later; client clock sync + bench harness in M1/M2 |
| 9 | LLM | `claude-haiku-5-5`, `thinking: {type: "disabled"}`, effort `low`, short `max_tokens`, prompt caching on system prompt (min cacheable prefix 512 tokens). Verify `cache_read_input_tokens` > 0 from turn 2. | Model/thinking in agent config; re-test tool reliability with thinking off in M1 |

### Small defaults
- **Barge-in:** on confirmed user speech while agent is speaking → stop playback (client) + cancel Claude & TTS streams (server). History keeps **only the part of the reply that was actually spoken**.
- **Secrets:** env vars locally, Fly secrets in deployment. No BYO keys in M0.
- **Voice style:** every system prompt gets the voice-style block (1–3 short sentences, no markdown, no lists).

## Latency stages logged per turn (server clock)
`speech_end` (last voiced frame) → `endpoint` → `stt_final` → `llm_request` → `llm_first_token` →
`tts_first_send` (first clause) → `tts_first_byte` → `audio_first_out` (first frame sent to browser).
**Server V2V = `audio_first_out − speech_end`.**

## Build order (≈3 weeks)

**Week 1 — Audio loop**
1. Monorepo scaffold, shared types (agent config schema, latency events, WS protocol).
2. Region probe script: TTFB from `iad` to Anthropic / ElevenLabs / Deepgram.
3. Browser mic capture (AudioWorklet → 16 kHz PCM16) → WS → orchestrator; playback of PCM from server.
4. ElevenLabs realtime STT client (persistent WS, VAD commit = Endpointer A). Show partial/final transcripts on page.

**Week 2 — Brain + voice**
5. Claude streaming client (Haiku 5.5, cached system prompt, history).
6. Clause chunker (first clause or ~8 words) → Deepgram Aura streaming TTS (persistent WS) → PCM to browser.
7. Turn state machine (`LISTENING → USER_SPEAKING → THINKING → SPEAKING`) + barge-in with spoken-text truncation.
8. Latency events → JSONL + live waterfall on demo page.

**Week 3 — Own VAD, gating, deploy, measure**
9. Silero VAD Endpointer (B); tunable silence threshold in agent config.
10. Invite code + JWT + caps + kill switch.
11. Dockerfile, Fly deploy (`iad`), Vercel deploy.
12. ~50 manual turns → latency report → tune → record results in this doc.

## Open items for the user
- Provide resume + 3–5 project blurbs for the concierge prompt (`apps/orchestrator/agents/portfolio-concierge.json`).
- API keys: Anthropic, ElevenLabs, Deepgram (put in `.env`, never committed).
- Choose a Deepgram Aura voice.

## Findings log

**2026-11-02 — Endpointer A (ElevenLabs VAD commit) measured**
- Test: `say`-generated question streamed in real time from the dev laptop (`scripts/stream-wav.ts`), `vad_silence_threshold_secs=0.3`.
- `endpoint − speech_end` ≈ **900 ms** (range 800–1350 ms over 6 runs); chunk size 100 ms vs 40 ms made no consistent difference.
- Network is not the cause: TCP connect to `api.elevenlabs.io` ≈ 15 ms from the laptop.
- Budget for endpointing + STT finalization is ~400–450 ms → **provider VAD alone costs ~2× budget. Endpointer B (local Silero VAD + manual commit) is required, not optional.**
- `keyterms` fixed name recognition ("Eshan" → "Eashan"). ElevenLabs rejects keyterms > 20 chars (now enforced in the config schema).

**2026-11-02 — Endpointer B (local Silero VAD + manual STT commit) measured**
- Silero v5 ONNX via onnxruntime-node: **0.18 ms per 32 ms window** on the laptop CPU.
- Same 3 `say` questions × 2 runs each, `silenceMs=300`:

| | endpointing (`endpoint − speech_end`) | STT finalize (`stt_final − endpoint`) | speech_end → final transcript |
|---|---|---|---|
| A: ElevenLabs VAD | — (combined) | — (combined) | **843–1198 ms** |
| B: Silero + manual commit | **293–338 ms** | **332–425 ms** | **649–719 ms** |

- B saves ~250–480 ms and removes most of the variance. Endpointing is now on budget (250–300 ms target).
- **New bottleneck: ElevenLabs commit → committed transcript ≈ 330–425 ms** (budget 100–150 ms).
  Plan: in week 2, start Claude speculatively on the latest partial transcript at endpoint time (PRD LR-7),
  and cancel/restart only if the committed text differs. At endpoint the partial usually already matches the final,
  which takes STT finalization off the critical path. Fallback option: benchmark another STT provider behind `SttProvider`.
- Default endpointer switched to `silero_vad` in `portfolio-concierge.json` (`ENDPOINTER=provider_vad` env var re-runs A).

**2026-11-02 — Claude loop working; latency dominated by Mumbai ↔ US**
- Functionally correct over a 4-turn session: accurate answers from the knowledge base, off-topic guardrail holds,
  history carries over, and the session-start `max_tokens: 0` pre-warm makes **turn 0 a cache hit** (3,214 tokens read).
- Speculative LLM start (LR-7) **never hit**: at endpoint (~300 ms after speech end) the ElevenLabs partial is missing
  or cut mid-word (`"Tell me about paint formu-"`). Partials lag ~1 s (docs: ~1 s processing chunks). Now off by default
  (`SPECULATIVE_LLM=1` to enable). Revisit with a different STT provider or if partial cadence improves.
- Claude TTFT from the laptop ≈ 800 ms (`scripts/bench-llm-ttft.ts`), and **`message_start` itself arrives at ~800 ms**.
  It doesn't change with prompt size, caching, thinking on/off, or model (Haiku 5.5 ≈ Haiku 4.5 ≈ Sonnet 5.5 ≈ 780–800 ms).
- Root cause: geography. From Mumbai, a trivial Anthropic API call has 330–450 ms time-to-first-byte (TCP connect 12 ms is a
  CDN edge, not the origin); Deepgram TCP connect alone is 215–405 ms. Model-side TTFT is therefore roughly 350–450 ms.
- **Implication: latency must be measured from the deployed orchestrator in US-East (Fly `iad`), not the laptop.**
  Pull the week-1 region probe + deploy forward.
- Open product question: browser ↔ orchestrator distance is outside "server V2V" but users feel it. If the demo audience
  is mostly in India, a US orchestrator adds ~250 ms each way for audio; providers' US-only origins make an India
  orchestrator slower overall. Decide when the demo audience is clearer.

**2026-11-02 — TTS + barge-in working (Deepgram Aura streaming)**
- `DeepgramTts`: one persistent WS per call (`Speak` + `Flush` per chunk → audio → `Flushed`). After `Clear`, audio already
  in flight keeps arriving until `Cleared` (~400 ms from Mumbai), so it's discarded. Reconnects lazily if Deepgram drops it.
- TTS first byte ≈ **250–320 ms from Mumbai** (expect ~100–150 ms from `iad`). Audio streams at ~2× real time; no playback
  underruns logged across test turns.
- Each chunk's audio starts with **~90 ms of silence (once 460 ms)**. The speaker trims leading silence from the first
  audio of every reply (20 ms pre-roll, max 300 ms trim), and `audio_first_out` marks the first *audible* frame.
- `ClauseChunker` ramps chunk sizes: clause ≥2 words → clause ≥6 words → sentences ≥15 words. Keeps first audio fast
  and Deepgram flushes at ~3–4 per reply. LLM-first-token → first TTS send is still **150–220 ms** (waiting for a
  boundary / hard cut at 10 words): a tuning knob for the `iad` measurement.
- Server V2V from the laptop: **~1.7–2.1 s** (endpointing ~300 + STT finalize ~350 + Claude TTFT ~800 + chunking ~200 +
  TTS ~280). Claude TTFT and TTS TTFB are mostly Mumbai↔US distance, so this is not a meaningful number until deployed.
- Barge-in: Silero speech start (≥96 ms voiced) during THINKING/SPEAKING → abort Claude, `Clear` TTS, `stop_playback`.
  History keeps only what was heard (server playhead estimate, refined by the client's exact `playedMs`).
  If nothing was heard yet, the user's new speech is **merged with their previous utterance** (`"Tell me about. His work
  at Kodo."`), which also fixes being cut off by a mid-sentence pause longer than `silenceMs`.
- Known limits: a noise blip during agent speech still cuts the agent off (no resume). Without headphones, barge-in relies
  on browser echo cancellation; validate on speakers before the public demo.

**2026-11-02 — Gating built and tested locally (decision 6)**
- Web `POST /api/session`: invite code (constant-time compare, 10 attempts / 10 min per IP) → HS256 session token,
  60 s TTL, single-use `jti`, plus the orchestrator URL. Secret and HMAC code verified absent from the client bundle.
- Orchestrator rejects: replayed / garbage / wrong-secret / expired tokens (4403), no `start` within 10 s (4408),
  3rd concurrent call (`busy`), kill switch off (`disabled`), daily budget spent (`budget_exhausted`).
  In-call: 3-min cap, 20 s silence hangup (verified: ends 20 s after the greeting), budget re-checked every second.
- Daily usage persists to `DATA_DIR/usage.json` (Fly volume), so auto-stop/restarts don't reset the budget.
  Gating state is per-process: Fly must run exactly one machine (M1: Redis).
- Deploy runbook: `docs/DEPLOY.md`. Latency report: `scripts/latency-report.ts` (p50/p95 per stage, exit bar check).

**2026-11-02 — Deployed to Fly `iad`; first real server numbers**
- `voiceforge-orchestrator.fly.dev` (1 machine, shared-cpu-1x 1 GB, volume `/data`). Image 182 MB, boots in ~10 s.
- 4 fixture turns (`stream-wav.ts` from the laptop; stages are on the server clock, so they're real `iad` numbers):

| stage | iad | laptop (Mumbai) |
|---|---|---|
| endpointing (silenceMs 300) | 319–321 | ~300–340 |
| STT finalize | **105–179** | 330–425 |
| Claude TTFT (Haiku 5.5, cached) | **498–572** | ~800 |
| chunker wait | 1–218 | 150–250 |
| TTS first byte | **124–140** | 250–320 |
| **server V2V** | **1151–1438** | ~1700–2100 |

- Claude TTFT from `iad`, real 3.2k-token prompt, 10 interleaved calls each: **Haiku 5.5 (cached, effort low) p50 567 ms**
  (508–928); **Haiku 4.5 (uncached: prompt is below its 4,096-token cache minimum) p50 430 ms** (357–601).
  On a trivial prompt Haiku 5.5 was erratic (p50 1.28 s, up to 2.9 s) while Haiku 4.5 held ~430 ms.
- Gap to the 700 ms bar is ~450–700 ms. Remaining levers, by size: LLM TTFT (model choice; speculative start needs a
  faster-partial STT), endpointing (silenceMs 300 → 200 is now safer thanks to the continuation merge), chunker wait
  (earlier first cut / short lead-in phrase), STT finalize (~130 ms, near floor).
