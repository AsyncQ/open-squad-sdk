/**
 * ISquadBackend — provider-agnostic inference backend contract.
 *
 * Every backend (Copilot, Anthropic, OpenAI-compatible) implements this
 * interface. SquadClient depends only on this — never on a concrete provider.
 */

import type {
  SquadSession,
  SquadSessionConfig,
  SquadSessionMetadata,
  SquadGetStatusResponse,
  SquadGetAuthStatusResponse,
  SquadModelInfo,
  SquadClientEventType,
  SquadClientEvent,
  SquadClientEventHandler,
} from './types.js';

export interface ISquadBackend {
  // ── Connection lifecycle ──────────────────────────────────────────────────
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  forceStop(): Promise<void>;

  // ── Session management ────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSession(config: SquadSessionConfig): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resumeSession(sessionId: string, config: SquadSessionConfig): Promise<any>;
  listSessions(): Promise<SquadSessionMetadata[]>;
  deleteSession(sessionId: string): Promise<void>;
  getLastSessionId(): Promise<string | undefined>;

  // ── Utility ───────────────────────────────────────────────────────────────
  ping(message?: string): Promise<{ message: string; timestamp: number; protocolVersion?: number }>;
  getStatus(): Promise<SquadGetStatusResponse>;
  getAuthStatus(): Promise<SquadGetAuthStatusResponse>;
  listModels(): Promise<SquadModelInfo[]>;

  // ── Client-level event subscription ──────────────────────────────────────
  on<K extends SquadClientEventType>(
    eventType: K,
    handler: (event: SquadClientEvent & { type: K }) => void
  ): () => void;
  on(handler: SquadClientEventHandler): () => void;
}

/**
 * Resolved per-agent backend config — merged result of:
 *   squad.config.ts provider (global) +
 *   .squad/config.json agentModelOverrides[agentName] (per-agent)
 */
export interface ResolvedAgentBackendConfig {
  /** Which backend implementation to use */
  backendType: 'copilot' | 'openai-compatible' | 'anthropic';
  /** Model identifier — format depends on backend (e.g. "anthropic/claude-sonnet-4-6" for OpenRouter) */
  model: string;
  /** API base URL — for openai-compatible backends (OpenRouter or local LLM) */
  baseUrl?: string;
  /** API key — empty string for local LLMs that don't require auth */
  apiKey?: string;
}
