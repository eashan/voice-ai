# VoiceForge

Real-time voice agent builder. See `PRD_Voice_Agent_Builder.md` and `docs/M0_PLAN.md`.

```
apps/orchestrator   Node voice orchestrator (data plane, WebSocket)
apps/web            Next.js demo page
packages/shared     Agent config schema, latency events, WS protocol
```

## Run (M0)
```bash
cp .env.example .env        # fill in keys
npm install
npm run dev:orchestrator    # :8787
npm run dev:web             # :3000
```
