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
