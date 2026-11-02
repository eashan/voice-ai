# Product Requirements Document
# VoiceForge — AI Voice Agent Builder

| Field | Value |
|---|---|
| Document version | 1.0 (Draft) |
| Date | 2 November 2026 |
| Author | Product Management |
| Status | Draft, for review |
| Approvers | Head of Product, Engineering Lead, Design Lead, Security Lead |
| Working name | **VoiceForge** (placeholder) |

---

## 1. Executive Summary

VoiceForge is a web app for designing, testing, deploying and monitoring **real-time conversational voice agents**. Each agent runs on a streaming pipeline:

- **Speech-to-Text (STT):** ElevenLabs (Scribe realtime, streaming)
- **Reasoning / "brain":** Anthropic Claude (Messages API, streaming, tool use)
- **Text-to-Speech (TTS):** Deepgram (Aura, streaming)

Builders can create any number of agent instances. Each one has its own **editable system prompt**, voice and behavior settings, **custom tool calls** that hit any HTTP API through a standard input/output schema, and connections to **any Model Context Protocol (MCP) server**.

**Latency is the main product differentiator.** The platform targets a **p50 voice-to-voice latency of ≤ 800 ms** (from the moment the user stops speaking to the first audio byte of the reply), and it shows that latency per turn so builders can tune it.

---

## 2. Problem Statement & Opportunity

### 2.1 Problems
1. **Slow conversations.** Many voice-agent stacks take 1.5–3 s to answer. That breaks conversational flow and leads to talk-over, hang-ups and low task completion.
2. **Closed tool ecosystems.** Connecting an agent to a company's own systems (CRM, booking, order lookup) often needs custom code, or is limited to a vendor's prebuilt integrations.
3. **Opaque behavior.** Builders can't easily see why a turn was slow, which tool was called with which arguments, or what the model was actually told.
4. **Slow iteration.** Changing a prompt or tool often means redeploying code, so non-engineers can't own agent quality.

### 2.2 Opportunity
A builder that puts best-in-class providers behind one latency-tuned orchestrator, and makes prompts, tools and MCP connections configurable without code, lets product and ops teams ship production voice agents in hours instead of weeks. MCP support also lets agents use the fast-growing ecosystem of MCP servers with no extra integration work.

---

## 3. Goals & Non-Goals

### 3.1 Goals (v1)
| # | Goal | Measure |
|---|---|---|
| G1 | Sub-second conversations | p50 voice-to-voice ≤ 800 ms; p95 ≤ 1,200 ms (excluding tool execution time) |
| G2 | Fast time-to-value | New user creates an agent and has a first test call in < 5 minutes |
| G3 | Open extensibility | Any REST/JSON API or remote MCP server can be attached without writing code |
| G4 | Per-agent control | Prompt, model, voice, tools, MCP and turn-taking are configurable per agent and versioned |
| G5 | Transparency | Every turn shows a stage-by-stage latency breakdown and a full tool-call trace |

### 3.2 Non-Goals (v1)
- PSTN / phone-number telephony (planned for v1.1: Twilio/SIP)
- Visual node-based conversation flow builder
- Model fine-tuning or training
- Voice cloning / custom voice creation UI
- Automatic mid-call language switching
- Mobile native SDKs (web and server SDKs only in v1)

---

## 4. Personas

| Persona | Description | Primary needs |
|---|---|---|
| **Agent Builder** (PM / CX ops, low-code) | Owns the agent's behavior and quality | Prompt editing, voice selection, testing, transcripts, analytics |
| **Developer / Integrator** | Connects agents to business systems | HTTP tool definitions, auth, MCP servers, SDK/API, webhooks |
| **Workspace Admin** | Manages the account | Members and roles, provider keys, billing/usage limits, audit log |
| **End User / Caller** | Talks to the deployed agent | Natural, fast, accurate conversations; can interrupt the agent |

---

## 5. Key User Journeys

**J1 — Build and test an agent (Agent Builder)**
1. Click "New Agent", then choose a template (e.g. Appointment Booking, Support Triage) or start blank.
2. Edit the system prompt and greeting, and insert variables such as `{{caller_name}}`.
3. Pick a Claude model (default: Haiku 5.5), an STT language and a Deepgram voice, and preview the voice.
4. Click "Test", talk to the agent in the browser, and watch the live transcript and latency waterfall.
5. Adjust the prompt, re-test, then publish v1.

**J2 — Add a custom API tool (Developer)**
1. Open Tools, click "New HTTP Tool", and either import from cURL/OpenAPI or define it manually.
2. Define the input JSON Schema (parameters Claude will fill), the method and URL, auth, and the output mapping.
3. Test the tool with sample input and inspect the response and timing.
4. Attach the tool to one or more agents and set a filler phrase ("One moment while I look that up").

**J3 — Connect an MCP server (Developer)**
1. Open MCP Servers and click "Add Server". Paste the URL, choose the transport, and set up auth (header token or OAuth).
2. The platform discovers the server's tools and shows their names, descriptions and schemas.
3. Allowlist specific tools for an agent and optionally override descriptions.
4. Test in the Playground. MCP tool calls appear in the trace like any other tool.

**J4 — Deploy and monitor (Builder / Admin)**
1. Publish the agent, then copy the web widget snippet or use the Sessions API.
2. Monitor calls: transcripts, latency percentiles, tool success rates and cost.
3. Receive a `call.ended` webhook with the transcript and summary in the downstream system.

---

## 6. Functional Requirements

Priority uses MoSCoW: **M** = Must, **S** = Should, **C** = Could.

### 6.1 Agent Management
| ID | Requirement | Pri |
|---|---|---|
| FR-1.1 | Create, read, update, delete and duplicate agents within a workspace | M |
| FR-1.2 | Start from templates (Blank, Receptionist, Support Triage, Appointment Booking, Lead Qualification) | S |
| FR-1.3 | **Versioning:** each agent has an editable Draft and immutable Published versions. Includes a diff view between versions and one-click rollback | M |
| FR-1.4 | Environments: Dev and Prod deployment targets, each pinned to an agent version | S |
| FR-1.5 | Agent metadata: name, description, tags, owner, last-modified | M |
| FR-1.6 | Export/import an agent definition as JSON (prompt, settings, tool bindings; secrets excluded) | C |

### 6.2 System Prompt Editor
| ID | Requirement | Pri |
|---|---|---|
| FR-2.1 | Rich text/code editor for the **system prompt**, separate per agent instance | M |
| FR-2.2 | Separate fields for the **first message / greeting** and an optional **end-call message** | M |
| FR-2.3 | **Dynamic variables** (`{{var}}`) resolved at session start from the API/widget payload, with defaults. Built-ins include `{{current_datetime}}` and `{{agent_name}}` | M |
| FR-2.4 | Live token count and an estimate of cache-eligible tokens | S |
| FR-2.5 | **Voice-style linter:** warns on content that sounds bad when spoken (markdown, bullet lists, URLs, long numbers, emojis) and suggests speech-friendly instructions | S |
| FR-2.6 | Prompt history with author and timestamp (tied to versioning) | M |
| FR-2.7 | Guardrails section: topics to refuse, escalation/transfer rules, PII handling instructions | S |
| FR-2.8 | AI-assisted prompt improvement ("Make this more concise for voice") using Claude | C |

### 6.3 Brain Configuration (Claude)
| ID | Requirement | Pri |
|---|---|---|
| FR-3.1 | Model selector: **Claude Haiku 5.5 (default, lowest latency)**, Claude Sonnet 5.5, Claude Opus 5.5. The UI labels each with its expected latency and cost | M |
| FR-3.2 | Parameters: temperature, max output tokens (default 300 for voice), stop sequences | M |
| FR-3.3 | **Prompt caching enabled by default** for the system prompt and tool definitions | M |
| FR-3.4 | Extended thinking **off by default**. Turning it on shows a latency warning | S |
| FR-3.5 | Conversation history management: rolling window plus optional auto-summarization past N turns, to limit input tokens | S |
| FR-3.6 | Fallback model if the primary model errors or times out (e.g. Sonnet → Haiku) | S |

### 6.4 Voice Configuration
| ID | Requirement | Pri |
|---|---|---|
| FR-4.1 | **STT (ElevenLabs Scribe realtime):** language selection, keyterm/vocabulary boosting (product names, proper nouns), partial-transcript streaming | M |
| FR-4.2 | **TTS (Deepgram Aura):** voice selection from the catalog, speaking rate, output encoding/sample rate matched to the channel | M |
| FR-4.3 | Voice preview: play a sample sentence (or the greeting) in the selected voice | M |
| FR-4.4 | Pronunciation dictionary: text substitutions applied before TTS (e.g. "SQL" → "sequel") | S |
| FR-4.5 | Number/date normalization for speech (e.g. "$1,250" → "twelve hundred fifty dollars") | S |
| FR-4.6 | Background ambience / comfort noise option | C |

### 6.5 Turn-Taking & Conversation Behavior
| ID | Requirement | Pri |
|---|---|---|
| FR-5.1 | Voice activity detection (VAD) with a configurable **endpointing silence threshold** (default 300 ms; range 150–1,500 ms) | M |
| FR-5.2 | **Barge-in / interruption:** when the user speaks during agent playback, stop TTS output within ≤ 100 ms and cancel in-flight LLM/TTS work | M |
| FR-5.3 | On interruption, **truncate the assistant message in history to what was actually played**, so Claude's context matches what the user heard | M |
| FR-5.4 | Backchannel handling: ignore short affirmations ("uh-huh", "okay") during playback (configurable list and minimum duration) | S |
| FR-5.5 | Idle handling: re-prompt after N seconds of silence, end the call after M re-prompts | M |
| FR-5.6 | Max call duration, and an end-call tool Claude can invoke | M |
| FR-5.7 | Semantic end-of-turn detection (model-based) to cut false endpoints in mid-sentence pauses | C |

### 6.6 Custom Tool Calls (HTTP APIs)
Tools are defined once at workspace level and bound to agents. Claude sees each tool as a standard tool definition (name, description, input schema).

**Tool definition fields**
| ID | Field / Capability | Pri |
|---|---|---|
| FR-6.1 | **Name** (snake_case, unique per agent) and **description** (instructions to Claude on when and how to use it) | M |
| FR-6.2 | **HTTP method** (GET/POST/PUT/PATCH/DELETE) and **URL** with path-parameter templating (`/orders/{order_id}`) | M |
| FR-6.3 | **Headers** and **query parameters**, both static and templated from arguments or session variables | M |
| FR-6.4 | **Auth:** None, API key (header/query), Bearer token, Basic, OAuth 2.0 client credentials. Secrets are stored in a vault and are **write-only** in the UI after saving | M |
| FR-6.5 | **Input schema** (JSON Schema): built with a visual form builder (field name, type, required, enum, description) or as raw JSON. Validated before the request is sent | M |
| FR-6.6 | **Output schema** (JSON Schema) plus **response mapping** (JSONPath/JMESPath selection) to trim the payload before it is returned to Claude. This reduces tokens and latency | M |
| FR-6.7 | **Timeout** (default 3 s, max 30 s), **retries** (0–2, idempotent methods only) | M |
| FR-6.8 | **Filler phrase:** spoken immediately if the tool hasn't returned in 400 ms (static text or "let Claude choose"). Pre-synthesized and cached | M |
| FR-6.9 | Execution mode: **Synchronous** (result returned to Claude) or **Fire-and-forget/async** (immediate ack; e.g. logging a lead) | S |
| FR-6.10 | **Test console:** run the tool with sample arguments and view the request, raw response, mapped output and timing | M |
| FR-6.11 | **Import** from cURL and from OpenAPI 3.x (pick operations, then auto-generate schemas) | S |
| FR-6.12 | Error contract: non-2xx, timeout and schema-validation failures are returned to Claude as structured errors so it can recover gracefully | M |
| FR-6.13 | Per-tool response size cap (default 16 KB after mapping) | M |
| FR-6.14 | **Built-in tools:** `end_call`, `transfer_call` (v1.1), `wait_for_user` | S |

**Standard I/O contract (default "envelope" mode)**

Request sent by the platform:
```json
{
  "tool": "lookup_order",
  "call_id": "tc_01HXYZ...",
  "session_id": "sess_01HXYZ...",
  "agent_id": "agt_123",
  "arguments": { "order_id": "A-10023" },
  "variables": { "caller_name": "Priya" }
}
```
Expected response:
```json
{ "result": { "status": "shipped", "eta": "2026-11-05" } }
```
or
```json
{ "error": { "code": "NOT_FOUND", "message": "No order with that ID" } }
```
**"Raw" mode** is also supported. In raw mode, arguments map to the path, query or body as configured, and any JSON response is passed through output mapping.

### 6.7 MCP Server Integration
| ID | Requirement | Pri |
|---|---|---|
| FR-7.1 | Register MCP servers at workspace level: name, URL, transport (**Streamable HTTP**, **SSE**). `stdio` is supported only in self-hosted deployments | M |
| FR-7.2 | Auth: static headers (bearer/API key) and the **OAuth 2.1** authorization flow from the MCP spec, with token refresh | M |
| FR-7.3 | **Auto-discovery** of tools (and listing of resources/prompts) via `tools/list`, showing schemas and descriptions | M |
| FR-7.4 | Per-agent **allowlist** of MCP tools (not all-or-nothing), plus optional description overrides and name prefixing to avoid collisions | M |
| FR-7.5 | Handle `notifications/tools/list_changed` and manual "Refresh tools". Tool lists are cached and versioned per agent publish | M |
| FR-7.6 | **Connection pre-warming:** MCP sessions open and initialize at call start (in parallel with the greeting), never on the first tool call | M |
| FR-7.7 | Health check and status indicator (connected / degraded / failed), with a per-server circuit breaker | S |
| FR-7.8 | Same filler-phrase, timeout and response-size-cap options as HTTP tools | M |
| FR-7.9 | MCP resources can be attached as static context to the agent prompt at session start | C |
| FR-7.10 | MCP tool calls are shown in traces with server, tool, arguments, result and duration | M |

*Implementation note:* the orchestrator runs its own **MCP client pool** rather than relying only on the Claude API's server-side MCP connector. This gives us connection reuse, pre-warming, custom timeouts/fillers and support for private-network servers. The API MCP connector may be offered as an option for simple remote servers.

### 6.8 Testing Playground
| ID | Requirement | Pri |
|---|---|---|
| FR-8.1 | In-browser voice call with the Draft or any Published version (WebRTC, mic permission) | M |
| FR-8.2 | Live transcript with partial and final user text and streamed agent text | M |
| FR-8.3 | **Per-turn latency waterfall:** endpoint detected → STT final → Claude TTFT → first TTS chunk sent → first audio played, plus tool durations | M |
| FR-8.4 | Tool-call inspector: arguments, request, response, mapped output, errors, duration | M |
| FR-8.5 | **Text-chat mode** (skips STT/TTS) for fast prompt iteration | M |
| FR-8.6 | Set test values for dynamic variables before starting | M |
| FR-8.7 | **Scenario tests:** scripted user turns with assertions (expected tool called, contains phrase, max latency). Can run in batch before publishing | S |
| FR-8.8 | Mock mode for tools (return a canned response) | S |

### 6.9 Deployment Channels
| ID | Requirement | Pri |
|---|---|---|
| FR-9.1 | **Embeddable web widget**: JS snippet with theme options and allowed-domain restrictions | M |
| FR-9.2 | **Sessions API**: `POST /v1/sessions` returns a short-lived token and WebRTC/WebSocket connection details. Accepts variables and metadata | M |
| FR-9.3 | Client SDK (TypeScript) for custom web UIs | S |
| FR-9.4 | Server-side WebSocket audio interface (for backend integrations) | S |
| FR-9.5 | Telephony: Twilio Media Streams / SIP (**v1.1**) | C |

### 6.10 Observability & Analytics
| ID | Requirement | Pri |
|---|---|---|
| FR-10.1 | Call log: list of sessions with agent, version, duration, end reason, channel, cost | M |
| FR-10.2 | Session detail: full transcript, tool trace, per-turn latency, errors | M |
| FR-10.3 | Audio recording (**opt-in** per agent, with a consent-message option) | S |
| FR-10.4 | Dashboards: p50/p90/p95 latency per stage, calls/day, avg duration, tool success rate, interruption rate | M |
| FR-10.5 | Cost breakdown per call: STT minutes, Claude input/output/cached tokens, TTS characters | S |
| FR-10.6 | Post-call webhooks (`call.started`, `call.ended`, `tool.failed`) with HMAC signatures | M |
| FR-10.7 | Post-call analysis: Claude-generated summary, outcome classification, custom extraction fields | S |
| FR-10.8 | Search and filter transcripts; export as CSV/JSON | S |

### 6.11 Workspace, Access & Billing
| ID | Requirement | Pri |
|---|---|---|
| FR-11.1 | Email/password and Google sign-in. SAML SSO (Enterprise, v1.1) | M |
| FR-11.2 | Roles: Owner, Admin, Editor, Viewer | M |
| FR-11.3 | Provider credentials: **bring your own keys** (ElevenLabs, Deepgram, Anthropic) **or** platform-managed keys with metered billing | M |
| FR-11.4 | Usage limits and alerts (monthly minutes, spend caps, concurrency) | M |
| FR-11.5 | Audit log of config changes, publishes and secret updates | S |
| FR-11.6 | Platform API keys with scopes | M |

---

## 7. Latency Requirements & Real-Time Architecture

Latency is a first-class requirement. Every design decision in the real-time path must be justified against the budget below.

### 7.1 Definitions
- **Voice-to-voice latency (V2V):** time from the end of the user's speech to the first agent audio sample played at the client.
- **TTFT:** Claude time to first token. **TTFB:** TTS time to first audio byte.

### 7.2 Turn Latency Budget (no tool call)
| Stage | p50 target | p95 target |
|---|---|---|
| Endpointing (silence detection) | 250–300 ms | 400 ms |
| STT finalization (ElevenLabs realtime) | 100–150 ms | 250 ms |
| Orchestrator overhead | ≤ 20 ms | 40 ms |
| Claude TTFT (Haiku 5.5, cached prompt) | 250–350 ms | 550 ms |
| Clause buffering before first TTS send | ≤ 50 ms | 100 ms |
| TTS TTFB (Deepgram Aura streaming) | 100–150 ms | 200 ms |
| Network + client jitter buffer | 50 ms | 100 ms |
| **Total V2V** | **≈ 750–800 ms** | **≤ 1,200 ms** |

With a tool call, the filler phrase must start within **≤ 1,000 ms** of the end of the user's speech, and the full answer should begin within V2V + tool latency + one more Claude TTFT.

### 7.3 Mandatory Latency Techniques
| ID | Technique |
|---|---|
| LR-1 | **End-to-end streaming:** audio in → partial transcripts → streamed tokens → streamed TTS → streamed audio out. No stage waits for the full output of the previous one |
| LR-2 | **WebRTC (Opus)** client transport for low jitter and built-in echo cancellation. WebSocket fallback |
| LR-3 | **Persistent provider connections:** open ElevenLabs STT and Deepgram TTS WebSockets at session start and keep them open for the whole call. HTTP/2 keep-alive pool to the Anthropic API |
| LR-4 | **Prompt caching** for the system prompt and tool definitions. Prompt structure keeps the static content first, so the cache hit rate is ≥ 90% from turn 2 |
| LR-5 | **Clause-level TTS chunking:** send the first chunk to TTS at the first clause/sentence boundary (or after ~8 words), then stream the rest |
| LR-6 | **Pre-synthesized audio cache** for greetings, filler phrases and common re-prompts (zero TTS latency) |
| LR-7 | **Speculative generation** (feature flag): start Claude on a stable partial transcript before the endpoint fires, and cancel or restart if the final transcript differs |
| LR-8 | **Parallel tool execution** when Claude emits several tool calls in one turn |
| LR-9 | **Filler audio** if a tool hasn't returned in 400 ms |
| LR-10 | **Pre-warm** MCP sessions, OAuth tokens and DNS/TLS to tool hosts at session start |
| LR-11 | **Region co-location:** orchestrator nodes deployed in regions close to provider endpoints. Sessions are routed to the closest healthy region |
| LR-12 | **No blocking I/O in the hot path:** transcripts, metrics and logs are emitted asynchronously to a queue. Config is loaded once at session start and held in memory |
| LR-13 | **Instant barge-in:** client-side VAD stops local playback immediately, and the server cancels LLM/TTS streams |
| LR-14 | **Concise-output defaults:** max tokens of 300, and a voice-style instruction block added to every system prompt ("respond in 1–3 short sentences unless asked for detail") |
| LR-15 | **Latency telemetry:** each stage timestamped with a monotonic clock. Turns breaching p95 are flagged in the UI |

### 7.4 System Architecture

```
                           CONTROL PLANE (non-real-time)
  ┌────────────────────────────────────────────────────────────────────┐
  │  Builder Web App (Next.js/React)  ──  Control API (REST)           │
  │        │                                   │                       │
  │   Postgres (agents, versions, tools,   Secrets Vault (KMS)          │
  │   MCP configs, sessions metadata)      Redis (config cache, rate)   │
  │        │                                   │                       │
  │   Analytics store (ClickHouse) ◄── Event Queue (Kafka/SQS) ◄──┐     │
  └──────────────────────────────────────────────────────────────┼─────┘
                                                                 │ async events
                           DATA PLANE (real-time)                │
  ┌───────────┐  WebRTC/Opus  ┌────────────────────────────────┐  │
  │  Browser  │◄─────────────►│   Voice Orchestrator (per call)│──┘
  │  Widget / │               │  - VAD / endpointing / barge-in│
  │  SDK      │               │  - Turn state machine          │
  └───────────┘               │  - Clause chunker              │
                              │  - Tool Executor (HTTP pool)   │
                              │  - MCP Client Pool             │
                              └──┬───────┬────────┬────────┬───┘
                     WS (stream) │       │ HTTPS  │ WS     │ HTTP / MCP
                                 ▼       ▼ stream ▼        ▼
                     ElevenLabs STT   Claude API   Deepgram TTS   Customer APIs
                     (Scribe RT)      (Messages)   (Aura)         & MCP servers
```

**Key design points**
- **Control plane and data plane are separate.** The builder UI and APIs can be deployed and scaled independently of real-time call handling. At session start the orchestrator loads an immutable snapshot of the agent version.
- **Stateful orchestrator per session**, written in a low-latency async runtime (e.g. Go, Rust or Node/TypeScript with careful backpressure). Horizontally scaled behind a session router.
- **Provider abstraction layer** for STT, LLM and TTS interfaces. ElevenLabs/Deepgram/Claude are the v1 defaults. Because both voice vendors offer both STT and TTS, the abstraction enables future A/B tests and failover without product changes.
- **Turn state machine:** `LISTENING → USER_SPEAKING → THINKING → (TOOL_RUNNING) → SPEAKING → LISTENING`. Interruptions move to `USER_SPEAKING` from any state.

### 7.5 Turn Sequence (with tool call)
1. User speaks. Audio streams to ElevenLabs and partial transcripts return.
2. The endpoint fires and the final transcript is appended to history.
3. Claude is streamed with the cached system prompt, tools and history.
4. Claude emits `tool_use`. The orchestrator validates the arguments against the input schema and fires the HTTP/MCP call. If there's no result after 400 ms, it plays the cached filler audio.
5. The result is mapped, size-capped and returned as `tool_result`. Claude streams the final answer.
6. Clauses stream to Deepgram and audio streams to the client.
7. All timestamps and the trace are emitted asynchronously.

---

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Availability** | Data plane 99.9% monthly; control plane 99.5%. Active calls survive control-plane outages |
| **Scalability** | v1: 500 concurrent calls per region, linear horizontal scale; agent config changes take effect on new sessions within 10 s of publish |
| **Resilience** | Provider timeouts with retry/failover (e.g. fallback Claude model, alternate voice); circuit breakers on tools and MCP servers; graceful spoken error ("I'm having trouble reaching that system…") |
| **Security** | TLS 1.2+ everywhere; secrets encrypted with KMS, never logged and never returned to the client; tenant isolation on all queries; signed webhooks (HMAC) |
| **SSRF protection** | Tool and MCP URLs are resolved and checked against blocked private/link-local/metadata IP ranges (unless the workspace explicitly enables private networking); DNS-rebinding protection; outbound egress proxy |
| **Prompt-injection hygiene** | Tool and MCP outputs are passed as `tool_result` data, never merged into the system prompt; size caps; per-agent tool allowlists; destructive tools can require confirmation phrasing |
| **Privacy & compliance** | Configurable retention (transcripts, audio); optional PII redaction in logs; GDPR/CCPA data export and deletion; SOC 2 Type II roadmap; recording-consent prompt option |
| **Accessibility** | Builder UI meets WCAG 2.1 AA |
| **Browser support** | Latest 2 versions of Chrome, Edge, Safari, Firefox (desktop and mobile web) |
| **Audio quality** | 16 kHz minimum STT input; echo cancellation and noise suppression on the client |

---

## 9. Data Model (High-Level)

| Entity | Key fields |
|---|---|
| Workspace | id, name, plan, limits, provider_key_mode |
| User / Membership | id, email, role, workspace_id |
| Agent | id, workspace_id, name, description, tags, draft_version_id, prod_version_id |
| AgentVersion | id, agent_id, version_no, system_prompt, greeting, variables_schema, model, llm_params, stt_config, tts_config, turn_config, created_by, published_at (immutable once published) |
| Tool | id, workspace_id, type (http/builtin), name, description, method, url_template, headers, auth_ref, input_schema, output_schema, response_mapping, timeout_ms, retries, filler, mode |
| Secret | id, workspace_id, kind, encrypted_value (vault ref) |
| McpServer | id, workspace_id, name, url, transport, auth_ref, status, cached_tools, last_synced_at |
| AgentToolBinding | agent_version_id, tool_id or (mcp_server_id + tool_name), name_override, description_override |
| Session | id, agent_version_id, channel, variables, started_at, ended_at, end_reason, cost |
| Turn | session_id, idx, role, text, interrupted, stage_timestamps |
| ToolInvocation | session_id, turn_idx, tool_ref, arguments, status, response_summary, duration_ms |

---

## 10. API Outline (Public v1)

| Method & Path | Purpose |
|---|---|
| `POST /v1/agents` · `GET /v1/agents` · `GET/PATCH/DELETE /v1/agents/{id}` | Agent CRUD (PATCH edits the Draft) |
| `POST /v1/agents/{id}/publish` · `POST /v1/agents/{id}/rollback` | Versioning |
| `POST /v1/tools` · `PATCH /v1/tools/{id}` · `POST /v1/tools/{id}/test` | Tool management and testing |
| `POST /v1/mcp-servers` · `POST /v1/mcp-servers/{id}/refresh` | MCP management and discovery |
| `POST /v1/sessions` | Start a session: `{agent_id, environment, variables, metadata}` returns `{session_id, token, ice_servers, ws_url}` |
| `GET /v1/sessions/{id}` | Transcript, trace, latency |
| Webhooks: `call.started`, `call.ended`, `tool.failed` | HMAC-signed event delivery |

---

## 11. UX — Key Screens

1. **Agents list:** cards/table with status (Draft/Published), last edited, 7-day calls and p50 latency.
2. **Agent editor** (tabbed, with a "Test" button always available in the header):
   - **Prompt:** system prompt editor, greeting, variables, voice-style linter panel
   - **Model:** Claude model, parameters, caching, history settings
   - **Voice:** STT language/keyterms, Deepgram voice picker with preview, pronunciation dictionary
   - **Tools:** bound HTTP tools and built-ins, plus "Add tool"
   - **MCP:** connected servers, tool allowlist checkboxes, status badges
   - **Behavior:** endpointing, interruptions, idle and max-duration settings
   - **Deploy:** environments, widget snippet, API example, webhooks
3. **Tool builder** (full-page drawer): Request (method, URL, headers, auth) · Input schema (form/JSON toggle) · Output mapping (live preview against test response) · Behavior (timeout, retries, filler, mode) · Test.
4. **MCP server panel:** connection form, OAuth button, discovered tool list with schemas.
5. **Playground:** mic control, live transcript (left), trace and latency waterfall (right), text/voice mode toggle, variable inputs.
6. **Analytics:** latency percentiles by stage (stacked), volume, tool success, cost. Drill-down to sessions.

---

## 12. Success Metrics

| Metric | Target (90 days post-GA) |
|---|---|
| p50 / p95 voice-to-voice latency (no tools) | ≤ 800 ms / ≤ 1,200 ms |
| Filler-start latency on tool turns (p95) | ≤ 1,000 ms |
| Barge-in stop latency (p95) | ≤ 150 ms |
| Prompt cache hit rate (turn ≥ 2) | ≥ 90% |
| Tool call success rate | ≥ 98% (excluding customer API 4xx) |
| Time from sign-up to first test call (median) | < 5 min |
| Weekly active agents (≥ 10 calls/week) | Growth KPI, baseline at launch |
| Call completion rate (not user-abandoned early) | ≥ 85% |
| Blended platform cost per minute | Tracked; target margin defined by Finance |

---

## 13. Release Plan

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Latency spike** (3 wks) | Orchestrator prototype: ElevenLabs STT → Claude Haiku → Deepgram TTS over WebRTC, barge-in, latency telemetry | p50 V2V ≤ 800 ms over 200 test turns in target region |
| **M1 — MVP / Private beta** (8 wks) | Agent CRUD, prompt editor and variables, model and voice config, HTTP tools (full schema I/O, auth, test console, filler), playground with waterfall, versioning, BYO keys | 10 design partners build and run agents; all M-priority FRs in 6.1–6.6 and 6.8 |
| **M2 — Public beta** (6 wks) | MCP integration (HTTP/SSE, OAuth, allowlists, pre-warm), web widget, Sessions API, call logs and analytics, webhooks, usage limits | MCP tools callable with p95 overhead ≤ 50 ms beyond server time; widget in production with partners |
| **M3 — GA** (6 wks) | Scenario tests, OpenAPI import, post-call analysis, cost dashboards, audit log, platform-managed billing | NFRs met; security review and pen test passed |
| **v1.1** | Telephony (Twilio/SIP), call transfer, SAML SSO, semantic turn detection | — |

---

## 14. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Provider latency variance or outages (STT/LLM/TTS) | Missed latency SLOs, failed calls | Per-provider health monitoring, region routing, fallback model/voice, provider abstraction for failover |
| Slow customer APIs / MCP servers | Long silences | Timeouts, cached filler audio, async mode, circuit breakers, latency shown to builders |
| Verbose LLM responses | Higher latency, unnatural speech | Voice-style defaults, max tokens, linter, Haiku default |
| False endpointing (cutting users off) | Poor experience | Tunable threshold, backchannel handling, semantic end-of-turn (v1.1) |
| Prompt injection via tool/MCP output | Unsafe actions, data leakage | Tool-result isolation, allowlists, output caps, confirmation for destructive tools |
| SSRF via user-defined tool URLs | Infrastructure compromise | IP-range blocking, egress proxy, DNS-rebinding defense |
| Cost overrun (tokens, minutes) | Margin erosion, surprise bills | Usage caps, alerts, prompt caching, history summarization |
| Unusual provider pairing (ElevenLabs STT + Deepgram TTS) mismatches roadmap features | Vendor lock-in or feature gaps | Abstraction layer; benchmark both directions in M0 |

---

## 15. Open Questions

1. Is telephony (inbound/outbound phone numbers) needed in v1, or is web-only acceptable for launch?
2. Pricing model: BYO keys only, platform-managed metered billing, or both at launch?
3. Deployment model: multi-tenant SaaS only, or a self-hosted/VPC option for enterprise (affects `stdio` MCP support)?
4. Which languages are required at launch, and do the chosen STT/TTS voices cover them with acceptable latency?
5. Recording and consent requirements per target jurisdiction (two-party consent states, EU)?
6. Should agents support multi-agent handoff (agent A transfers to agent B with context) in v1.x?

---

## 16. Appendix

### 16.1 Glossary
- **VAD:** voice activity detection, which detects when someone is speaking.
- **Endpointing:** deciding that the user has finished their turn.
- **Barge-in:** the user interrupting the agent while it is speaking.
- **TTFT / TTFB:** time to first token (LLM) / time to first byte (TTS audio).
- **MCP:** Model Context Protocol, an open protocol that exposes tools, resources and prompts to AI applications.
- **Prompt caching:** reusing processed prompt prefixes across requests to cut latency and cost.

### 16.2 Sample HTTP Tool Definition
```json
{
  "name": "check_availability",
  "description": "Check open appointment slots for a given date. Use when the caller asks to book or reschedule.",
  "type": "http",
  "method": "POST",
  "url": "https://api.example-clinic.com/v1/availability",
  "auth": { "type": "bearer", "secret_ref": "sec_clinic_api" },
  "headers": { "X-Location": "{{location_id}}" },
  "input_schema": {
    "type": "object",
    "properties": {
      "date": { "type": "string", "format": "date", "description": "Requested date, YYYY-MM-DD" },
      "provider": { "type": "string", "description": "Optional doctor name" }
    },
    "required": ["date"]
  },
  "output_schema": {
    "type": "object",
    "properties": { "slots": { "type": "array", "items": { "type": "string" } } }
  },
  "response_mapping": "$.data.slots[0:5]",
  "timeout_ms": 3000,
  "retries": 1,
  "filler": "Let me check the schedule for you.",
  "mode": "sync",
  "io_mode": "envelope"
}
```

### 16.3 Sample MCP Server Configuration
```json
{
  "name": "crm",
  "url": "https://mcp.example-crm.com/mcp",
  "transport": "streamable_http",
  "auth": { "type": "oauth2", "client_id": "voiceforge", "scopes": ["contacts.read", "notes.write"] },
  "agent_binding": {
    "allowed_tools": ["search_contact", "create_note"],
    "name_prefix": "crm_",
    "overrides": {
      "search_contact": { "description": "Find the caller's CRM record by phone or email." }
    },
    "timeout_ms": 2500,
    "filler": "One moment while I pull up your account."
  }
}
```
