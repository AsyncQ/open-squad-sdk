/**
 * Squad Configuration Schema
 * Typed configuration interface for Squad teams
 */

import { SquadProviderConfig } from "../adapter/types.js";

export interface SquadConfig {
  version: string;
  team: TeamConfig;
  routing: RoutingConfig;
  models: ModelConfig;
  agents: AgentConfig[];
  hooks?: HooksConfig;
  ceremonies?: CeremonyConfig[];
  plugins?: PluginConfig;
  /**
   * Inference provider — selects the backend for all agent calls.
   * Omit to use GitHub Copilot (default, backward compatible).
   *
   * OpenRouter:  { type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '...' }
   * Local LLM:   { type: 'openai', baseUrl: 'http://localhost:1234/v1' }
   * Anthropic:   { type: 'anthropic', apiKey: '...' }
   */
  provider?: SquadProviderConfig;
  /**
   * Orchestrator selection.
   * - 'copilot'     → GitHub Copilot drives the coordination loop (default)
   * - 'claude-code' → Claude Code acts as orchestrator; agents run via provider
   * @default 'copilot'
   */
  orchestrator?: 'copilot' | 'claude-code';
  /** Ralph triage configuration */
  ralph?: RalphConfig;
}

export interface RalphConfig {
  /**
   * How often Ralph runs the triage loop (in minutes).
   * Typically wired to a GitHub Actions schedule.
   * @default 15
   */
  intervalMinutes?: number;
  /**
   * Maximum number of open issues Ralph processes per run.
   * Prevents runaway API usage on large backlogs.
   * @default 20
   */
  maxIssuesPerRun?: number;
}

export interface TeamConfig {
  name: string;
  description?: string;
  projectContext?: string;
  issueSource?: {
    repo: string;
    filters?: string[];
  };
}

export interface AgentConfig {
  name: string;
  role: string;
  displayName?: string;
  charter?: string;
  model?: string;
  tools?: string[];
  status?: 'active' | 'inactive' | 'retired';
}

export interface RoutingConfig {
  rules: RoutingRule[];
  defaultAgent?: string;
  fallbackBehavior?: 'ask' | 'default-agent' | 'coordinator';
}

export interface RoutingRule {
  pattern: string;
  agents: string[];
  tier?: 'direct' | 'lightweight' | 'standard' | 'full';
  priority?: number;
}

export interface ModelConfig {
  default: string;
  defaultTier: 'premium' | 'standard' | 'fast';
  tiers: Record<string, string[]>;
  agentOverrides?: Record<string, string>;
  taskTypeMapping?: Record<string, string>;
}

export interface HooksConfig {
  allowedWritePaths?: string[];
  blockedCommands?: string[];
  maxAskUserPerSession?: number;
  scrubPii?: boolean;
  reviewerLockout?: boolean;
}

export interface CeremonyConfig {
  name: string;
  schedule?: string;
  participants?: string[];
  agenda?: string;
  enabled?: boolean;
}

export interface PluginConfig {
  enabled: string[];
  config?: Record<string, unknown>;
}

export const DEFAULT_CONFIG: SquadConfig = {
  version: '0.7.0',
  team: {
    name: 'Default Squad',
    description: 'A Squad team',
  },
  routing: {
    rules: [],
    fallbackBehavior: 'coordinator',
  },
  models: {
    default: 'claude-sonnet-4',
    defaultTier: 'standard',
    tiers: {
      premium: ['claude-opus-4', 'claude-opus-4.5'],
      standard: ['claude-sonnet-4', 'claude-sonnet-4.5', 'gpt-5.1-codex'],
      fast: ['claude-haiku-4.5', 'gpt-5.1-codex-mini'],
    },
  },
  agents: [],
};

export function defineProvider(config: SquadProviderConfig): SquadProviderConfig {
  return config;
}

export function defineConfig(config: Partial<SquadConfig>): SquadConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    team: {
      ...DEFAULT_CONFIG.team,
      ...config.team,
    },
    routing: {
      ...DEFAULT_CONFIG.routing,
      ...config.routing,
      rules: config.routing?.rules ?? DEFAULT_CONFIG.routing.rules,
    },
    models: {
      ...DEFAULT_CONFIG.models,
      ...config.models,
      tiers: config.models?.tiers ?? DEFAULT_CONFIG.models.tiers,
    },
    agents: config.agents ?? DEFAULT_CONFIG.agents,
    provider: config.provider,
  };
}

export function validateConfig(config: unknown): config is SquadConfig {
  if (typeof config !== 'object' || config === null) return false;
  
  const c = config as Partial<SquadConfig>;
  
  if (typeof c.version !== 'string') return false;
  if (!c.team || typeof c.team.name !== 'string') return false;
  if (!c.routing || !Array.isArray(c.routing.rules)) return false;
  if (!c.models || typeof c.models.default !== 'string') return false;
  if (!Array.isArray(c.agents)) return false;
  if (c.provider !== undefined && typeof c.provider.baseUrl !== 'string') return false;

  return true;
}
