# Deploying the M0 demo

Orchestrator → **Fly.io `iad`** (one machine, volume at `/data`). Web → **Vercel**.
The browser gets a 60-second, single-use session token from the web app (after the invite code) and presents it to the
orchestrator. Both sides share `SESSION_JWT_SECRET`. Provider keys live **only** on Fly.

## 0. Backstops first (provider consoles)
- Anthropic: set a monthly spend limit on the workspace that owns the key.
- ElevenLabs: key restricted to **Speech to Text**, with a credit limit.
- Deepgram: use a project key and keep an eye on the balance.

## 1. Production secrets file (local, gitignored)
```bash
cat > .env.deploy <<EOF
SESSION_JWT_SECRET=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')
DEMO_INVITE_CODE=<pick-an-invite-code>
EOF
```

## 2. Orchestrator on Fly
```bash
brew install flyctl && fly auth login
fly apps create voiceforge-orchestrator            # if taken, pick another name and update fly.toml
fly volumes create voiceforge_data --region iad --size 1 --yes
# Keys + JWT secret → Fly secrets (piped, never printed)
{ grep -E '^(ANTHROPIC|ELEVENLABS|DEEPGRAM)_API_KEY=' .env; grep '^SESSION_JWT_SECRET=' .env.deploy; echo DEMO_ENABLED=true; } \
  | fly secrets import
fly deploy                                          # remote builder; no local Docker needed
fly scale count 1 --yes                             # gating state is per-process: exactly one machine
curl https://voiceforge-orchestrator.fly.dev/healthz
```

## 3. Measure server latency from the laptop
Server V2V is measured on the orchestrator's clock, so a laptop client gives real `iad` numbers:
```bash
SESSION_JWT_SECRET=$(grep '^SESSION_JWT_SECRET=' .env.deploy | cut -d= -f2-) \
  npx tsx scripts/stream-wav.ts scripts/fixtures/q1.wav scripts/fixtures/q2.wav scripts/fixtures/q3.wav \
  wss://voiceforge-orchestrator.fly.dev/ws
fly ssh sftp get /data/latency-$(date -u +%F).jsonl logs/fly-latency-$(date -u +%F).jsonl
npx tsx scripts/latency-report.ts logs/fly-latency-*.jsonl
```

## 4. Web on Vercel
Import the GitHub repo in the Vercel dashboard → **Root Directory: `apps/web`** (framework auto-detected: Next.js).
Environment variables (Production):

| Name | Value |
|---|---|
| `SESSION_JWT_SECRET` | same as in `.env.deploy` |
| `DEMO_INVITE_CODE` | from `.env.deploy` |
| `ORCHESTRATOR_WS_URL` | `wss://voiceforge-orchestrator.fly.dev/ws` |

Then lock the orchestrator to the site's origin:
```bash
fly secrets set ALLOWED_ORIGINS=https://<your-project>.vercel.app
```

## Operating
- **Kill switch:** `fly secrets set DEMO_ENABLED=false` (restarts; new calls rejected). Re-enable with `true`.
- **Caps** (`fly.toml [env]`): 2 concurrent calls, 3-minute calls, 20 s silence hangup, 60 min/day (UTC).
- **Status:** `curl …/healthz` → `{enabled, activeCalls, budgetLeftMinutes}`. Logs: `fly logs` (one `[turn]` line per turn).
- **Rotate the invite code:** change `DEMO_INVITE_CODE` in Vercel and redeploy. Rotating `SESSION_JWT_SECRET` needs both sides.
