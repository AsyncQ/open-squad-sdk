# @asyncq/open-squad-sdk

**Provider-agnostic multi-agent runtime.** Build AI teams that persist, learn, and coordinate — powered by any LLM, not locked to any vendor.

[![Status](https://img.shields.io/badge/status-production-brightgreen)](#requirements)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-green)](#requirements)
[![ESM](https://img.shields.io/badge/module-ESM--only-blue)](#requirements)
[![License](https://img.shields.io/badge/license-MIT-blue)](#license)

> Forked from [@bradygaster/squad-sdk](https://github.com/bradygaster/squad) and extended with multi-provider support. All Squad conventions, file structures, and governance stay exactly the same — only the inference layer is swappable.

---

## Install

```bash
npm install @asyncq/open-squad-sdk
```

Optional peer dependencies — install only what you need:

```bash
# GitHub Copilot backend (default)
npm install @github/copilot-sdk

# Direct Anthropic API backend
npm install @anthropic-ai/sdk

# OpenRouter or local LLM — already included as a required dep
# (openai package is bundled)
```

---

## What Changed From the Original

The original `@bradygaster/squad-sdk` is tightly coupled to GitHub Copilot — every agent session goes through the Copilot CLI. This fork replaces that single dependency with a pluggable `ISquadBackend` interface.

Everything else is identical: `.squad/` folder conventions, charter format, routing rules, decisions log, casting engine, skills system, Ralph, hook pipeline.

| | `@bradygaster/squad-sdk` | `@asyncq/open-squad-sdk` |
|---|---|---|
| GitHub Copilot | Required | Optional |
| OpenRouter | Not supported | Built-in |
| Local LLM (Ollama, LM Studio) | Not supported | Built-in |
| Direct Anthropic API | Not supported | Built-in |
| Per-agent model switching | Not supported | Built-in |
| `.squad/config.json` escalation model | Not supported | Built-in |
| All Squad conventions | ✅ | ✅ identical |

---

## Backends

### GitHub Copilot (default)

No config needed — same behaviour as the original SDK.

```ts
// squad.config.ts
export default defineConfig({
  team: { name: 'My Team' },
  orchestrator: 'copilot', // default
});
```

Requires `@github/copilot-sdk` installed. Falls back to a clear error if missing.

---

### OpenRouter

Access any cloud model — Claude, GPT-4, DeepSeek, Gemini — through one endpoint. Swap models per-agent without touching code.

```ts
// squad.config.ts
export default defineConfig({
  team: { name: 'My Team' },
  orchestrator: 'claude-code',
  provider: {
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
  },
});
```

```json
// .squad/config.json
{
  "version": 1,
  "defaultModel": "anthropic/claude-sonnet-4-6",
  "escalationModel": "anthropic/claude-opus-4-7",
  "agentModelOverrides": {
    "danny":  { "model": "anthropic/claude-opus-4-7" },
    "marcus": { "model": "deepseek/deepseek-chat" },
    "scribe": { "model": "anthropic/claude-haiku-4-5" }
  }
}
```

---

### Local LLM (LM Studio / Ollama / llama.cpp)

Point `baseUrl` at your local server. No API key needed.

```ts
// squad.config.ts
export default defineConfig({
  team: { name: 'My Team' },
  provider: {
    type: 'openai',
    baseUrl: 'http://localhost:1234/v1', // LM Studio default
  },
});
```

```json
// .squad/config.json
{
  "version": 1,
  "defaultModel": "llama-3.1-8b-instruct",
  "escalationModel": "llama-3.3-70b-instruct"
}
```

---

### Direct Anthropic API

Skip OpenRouter and call Anthropic directly. Charter system prompts are automatically cached with `cache_control: ephemeral` for ~90% cost reduction on repeated agent turns.

```ts
// squad.config.ts
export default defineConfig({
  team: { name: 'My Team' },
  provider: {
    type: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
});
```

---

## Per-Agent Model Switching

`.squad/config.json` is hot-read on every agent invocation. Change a model, the next run picks it up — no restart.

```json
{
  "version": 1,
  "defaultModel": "anthropic/claude-sonnet-4-6",
  "escalationModel": "anthropic/claude-opus-4-7",
  "agentModelOverrides": {
    "marcus": { "model": "deepseek/deepseek-chat" }
  }
}
```

You can also route a single agent to a completely different provider:

```json
{
  "agentModelOverrides": {
    "scribe": {
      "model": "llama-3.1-8b-instruct",
      "baseUrl": "http://localhost:1234/v1"
    }
  }
}
```

### Model comparison workflow

```
1. Marcus runs with deepseek/deepseek-chat → opens PR
2. You review the PR → not satisfied
3. Edit .squad/config.json → "marcus": { "model": "anthropic/claude-sonnet-4-6" }
4. Marcus runs again on the same task → Claude produces a different PR
5. Optionally: Claude-Marcus reviews DeepSeek-Marcus's PR
6. Pick the result you prefer
```

Update overrides from code:

```ts
import { setAgentModelOverride } from '@asyncq/open-squad-sdk/runtime/agent-model-config';

await setAgentModelOverride('.', 'marcus', {
  model: 'anthropic/claude-sonnet-4-6',
});
```

---

## Ralph Escalation Chain

Ralph's triage now has a three-step escalation before anything reaches you:

```
Issue lands in .squad/decisions/inbox/
  → Rule-based triage (free, no LLM)
    → Resolved (high/medium confidence) → writes decision, done
    → Low confidence / unresolved
      → LLM call with defaultModel
        → Resolved → writes decision, done
        → Unresolved
          → LLM call with escalationModel
            → Resolved → writes decision, done
            → Still unresolved → writes question to developer inbox
```

Configure Ralph's timer in `squad.config.ts`:

```ts
export default defineConfig({
  ralph: {
    intervalMinutes: 15,
    maxIssuesPerRun: 20,
  },
});
```

Use `triageIssueWithLlmEscalation()` directly:

```ts
import { triageIssueWithLlmEscalation } from '@asyncq/open-squad-sdk/ralph/triage';

const result = await triageIssueWithLlmEscalation(
  issue,
  rules,
  modules,
  roster,
  {
    defaultModel: 'anthropic/claude-sonnet-4-6',
    escalationModel: 'anthropic/claude-opus-4-7',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
  }
);

if (result.needsDeveloper) {
  // write to .squad/decisions/inbox/ for human review
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Orchestrator (your choice)                     │
│  - 'claude-code': Claude Code reads .squad/,    │
│    routes work, invokes agents sequentially     │
│  - 'copilot': GitHub Copilot drives the loop    │
└─────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────┐
│  Agent Orchestration Runtime                    │
│  - Router (matchRoute, compileRoutingRules)     │
│  - Charter Compiler (permissions, voice)        │
│  - Model Selector (4-layer priority)            │
│  - Hook Pipeline (governance enforcement)       │
└─────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────┐
│  Session Pool + Event Bus                       │
│  - Each agent gets a persistent session         │
│  - Cross-session event pub/sub                  │
│  - State persisted to .squad/ between runs      │
└─────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────┐
│  ISquadBackend (swappable)                      │
│  ┌────────────┐ ┌────────────┐ ┌─────────────┐ │
│  │  Copilot   │ │ OpenAI-    │ │  Anthropic  │ │
│  │  Backend   │ │ Compatible │ │  Backend    │ │
│  │ (optional) │ │ (OpenRouter│ │  (optional) │ │
│  │            │ │ /local LLM)│ │             │ │
│  └────────────┘ └────────────┘ └─────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## Hook Pipeline

Rules run as code before tools execute — not as prompt suggestions.

```typescript
const pipeline = new HookPipeline({
  allowedWritePaths: ['src/**/*.ts', '.squad/**', 'docs/**'],
  scrubPii: true,
  maxAskUserPerSession: 3,
});
```

- **File-write guards** — agents can't write outside allowed paths, period
- **PII scrubbing** — emails, tokens, secrets never escape tool output
- **Reviewer lockout** — once a reviewer rejects a file, the original author can't rewrite it
- **Ask-user rate limiter** — agents decide or move on; they don't stall waiting for you

---

## Persistent Sessions

Sessions survive crashes. State persists to `.squad/` between runs.

```typescript
const session = await client.createSession({
  agentName: 'Backend',
  task: 'Implement user auth endpoints',
});

// Agent crashes mid-work
const resumed = await client.resumeSession(sessionId);
// Backend wakes up knowing what it wrote and where it left off
```

---

## Storage

All persistent I/O flows through a pluggable `StorageProvider`.

| Provider | Use When |
|----------|----------|
| `FSStorageProvider` | Default — stores everything on disk |
| `InMemoryStorageProvider` | Unit tests or ephemeral sessions |
| `SQLiteStorageProvider` | Single portable database file (WASM, works everywhere) |

---

## API Reference

| Module | Key Exports |
|--------|-------------|
| `adapter/backend` | `ISquadBackend`, `ResolvedAgentBackendConfig` |
| `adapter/backends` | `CopilotBackend`, `OpenAICompatibleBackend`, `AnthropicBackend` |
| `runtime/agent-model-config` | `loadAgentModelConfig()`, `resolveAgentModel()`, `setAgentModelOverride()` |
| `ralph/triage` | `triageIssue()`, `triageIssueWithLlmEscalation()` |
| `config` | `loadConfig()`, `loadConfigSync()` |
| `casting` | `CastingEngine` |
| `skills` | Skills system |
| `coordinator` | `selectResponseTier()` |
| `runtime` | Streaming pipeline, cost tracker, telemetry |

---

## Requirements

- **Node.js** ≥ 22.5.0
- **TypeScript** ≥ 5.0
- **ESM-only** — set `"type": "module"` in your `package.json`

---

## Links

- **Repository:** [github.com/AsyncQ/open-squad-sdk](https://github.com/AsyncQ/open-squad-sdk)
- **Issues:** [github.com/AsyncQ/open-squad-sdk/issues](https://github.com/AsyncQ/open-squad-sdk/issues)
- **Original SDK:** [github.com/bradygaster/squad](https://github.com/bradygaster/squad)

---

## License

MIT
