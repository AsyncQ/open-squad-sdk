/**
 * .squad/config.json schema and loader.
 *
 * This file is the runtime model config — hot-read on every agent invocation,
 * no restart needed. Change an agent's model here mid-session and the next
 * invocation picks it up immediately.
 *
 * Example .squad/config.json:
 * {
 *   "version": 1,
 *   "defaultModel": "anthropic/claude-sonnet-4-6",
 *   "escalationModel": "anthropic/claude-opus-4-7",
 *   "agentModelOverrides": {
 *     "scribe":  { "model": "anthropic/claude-haiku-4-5" },
 *     "marcus":  { "model": "deepseek/deepseek-chat" },
 *     "danny":   { "model": "anthropic/claude-opus-4-7" },
 *     "ralph":   {
 *       "model": "anthropic/claude-sonnet-4-6",
 *       "baseUrl": "https://openrouter.ai/api/v1",
 *       "apiKey": "sk-or-..."
 *     }
 *   }
 * }
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * Per-agent model override.
 * When baseUrl is omitted, the global provider from squad.config.ts is used.
 */
export interface AgentModelOverride {
  /** Model identifier — format depends on provider (e.g. "anthropic/claude-sonnet-4-6" for OpenRouter) */
  model: string;
  /** Override provider base URL for this agent only (e.g. route one agent to local LLM) */
  baseUrl?: string;
  /** API key for the per-agent provider override */
  apiKey?: string;
}

/**
 * Schema for .squad/config.json — the runtime model configuration.
 */
export interface SquadAgentModelConfig {
  /** Schema version — currently 1 */
  version: 1;
  /**
   * Default model for all agents that don't have an override.
   * Use provider-prefixed model IDs for OpenRouter (e.g. "anthropic/claude-sonnet-4-6").
   */
  defaultModel: string;
  /**
   * Model Ralph uses for a second attempt when the first triage fails.
   * Should be a more capable / larger model than defaultModel.
   * @example "anthropic/claude-opus-4-7"
   */
  escalationModel?: string;
  /**
   * Per-agent model overrides. Key is the agent name (matches charter filename
   * without extension, e.g. "marcus", "stella", "ralph").
   * Change this at runtime — the next agent invocation reads the new value.
   */
  agentModelOverrides?: Record<string, AgentModelOverride | string>;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_AGENT_MODEL_CONFIG: SquadAgentModelConfig = {
  version: 1,
  defaultModel: 'anthropic/claude-sonnet-4-6',
  escalationModel: 'anthropic/claude-opus-4-7',
  agentModelOverrides: {},
};

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load .squad/config.json from the given team root.
 * Returns defaults if the file doesn't exist yet.
 * Throws on malformed JSON.
 */
export async function loadAgentModelConfig(teamRoot: string): Promise<SquadAgentModelConfig> {
  const configPath = join(teamRoot, '.squad', 'config.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SquadAgentModelConfig>;
    return { ...DEFAULT_AGENT_MODEL_CONFIG, ...parsed };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULT_AGENT_MODEL_CONFIG };
    }
    throw new Error(`Failed to parse .squad/config.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Resolve the model + optional provider override for a specific agent.
 * Merges global default with per-agent override, per-agent override wins.
 */
export function resolveAgentModel(
  agentName: string,
  config: SquadAgentModelConfig,
): { model: string; baseUrl?: string; apiKey?: string } {
  const override = config.agentModelOverrides?.[agentName];

  if (!override) {
    return { model: config.defaultModel };
  }

  if (typeof override === 'string') {
    return { model: override };
  }

  return {
    model: override.model,
    baseUrl: override.baseUrl,
    apiKey: override.apiKey,
  };
}

/**
 * Persist a model override for an agent back to .squad/config.json.
 * Safe to call while the team is running — next invocation picks it up.
 */
export async function setAgentModelOverride(
  teamRoot: string,
  agentName: string,
  override: AgentModelOverride | string,
): Promise<void> {
  const current = await loadAgentModelConfig(teamRoot);
  const updated: SquadAgentModelConfig = {
    ...current,
    agentModelOverrides: {
      ...(current.agentModelOverrides ?? {}),
      [agentName]: override,
    },
  };
  const configPath = join(teamRoot, '.squad', 'config.json');
  await writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8');
}
