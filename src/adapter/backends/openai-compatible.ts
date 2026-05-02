/**
 * OpenAICompatibleBackend — covers OpenRouter and local LLMs.
 *
 * One implementation for two use cases:
 *   - OpenRouter:  baseUrl = "https://openrouter.ai/api/v1", apiKey = OPENROUTER_API_KEY
 *   - Local LLM:   baseUrl = "http://localhost:1234/v1",     apiKey = "" (or "ollama")
 *
 * Uses the `openai` npm package with a custom baseUrl — OpenRouter and most
 * local LLM servers (LM Studio, Ollama, llama.cpp) are OpenAI-compatible.
 *
 * Session state (message history) is held in memory per session and can be
 * persisted via the optional storageProvider.
 */

import type { ISquadBackend } from '../backend.js';
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
  SquadSessionEvent,
  SquadSessionEventType,
  SquadSessionEventHandler,
  SquadMessageOptions,
} from '../types.js';
import { randomUUID } from 'crypto';

export interface OpenAICompatibleBackendOptions {
  baseUrl: string;
  apiKey?: string;
  /** Default model — overridden per-session via SquadSessionConfig.model */
  defaultModel?: string;
  /** Optional HTTP headers added to every request (e.g. HTTP-Referer for OpenRouter) */
  defaultHeaders?: Record<string, string>;
}

// ─── In-memory session ───────────────────────────────────────────────────────

type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

interface StoredMessage {
  role: MessageRole;
  content: string;
  tool_call_id?: string;
  name?: string;
}

class OpenAICompatibleSession implements SquadSession {
  readonly sessionId: string;
  private readonly client: import('openai').OpenAI;
  private readonly model: string;
  private history: StoredMessage[] = [];
  private readonly eventHandlers = new Map<string, Set<SquadSessionEventHandler>>();
  private readonly metadata: SquadSessionMetadata;

  constructor(
    sessionId: string,
    client: import('openai').OpenAI,
    model: string,
    systemPrompt?: string,
  ) {
    this.sessionId = sessionId;
    this.client = client;
    this.model = model;
    this.metadata = {
      sessionId,
      startTime: new Date(),
      modifiedTime: new Date(),
      isRemote: false,
    };
    if (systemPrompt) {
      this.history.push({ role: 'system', content: systemPrompt });
    }
  }

  on(eventType: SquadSessionEventType, handler: SquadSessionEventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
  }

  off(eventType: SquadSessionEventType, handler: SquadSessionEventHandler): void {
    this.eventHandlers.get(eventType)?.delete(handler);
  }

  private emit(event: SquadSessionEvent): void {
    this.eventHandlers.get(event.type)?.forEach(h => h(event));
  }

  async sendMessage(options: SquadMessageOptions): Promise<void> {
    this.history.push({ role: 'user', content: options.prompt });
    this.metadata.modifiedTime = new Date();

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: this.history as import('openai').OpenAI.ChatCompletionMessageParam[],
      stream: true,
    });

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        fullContent += delta;
        this.emit({ type: 'message_delta', content: delta });
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    this.history.push({ role: 'assistant', content: fullContent });

    this.emit({
      type: 'usage',
      inputTokens,
      outputTokens,
      model: this.model,
    });

    this.emit({ type: 'turn_end', content: fullContent });
  }

  async sendAndWait(options: SquadMessageOptions, timeout = 120_000): Promise<unknown> {
    await Promise.race([
      this.sendMessage(options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Session ${this.sessionId} timed out after ${timeout}ms`)), timeout)
      ),
    ]);
    return this.history[this.history.length - 1]?.content;
  }

  async abort(): Promise<void> {
    // Streaming abort — future: hold AbortController per in-flight request
  }

  async getMessages(): Promise<unknown[]> {
    return [...this.history];
  }

  async close(): Promise<void> {
    this.eventHandlers.clear();
    this.history = [];
  }

  getMetadata(): SquadSessionMetadata {
    return { ...this.metadata };
  }
}

// ─── Backend ─────────────────────────────────────────────────────────────────

export class OpenAICompatibleBackend implements ISquadBackend {
  private openai!: import('openai').OpenAI;
  private readonly options: OpenAICompatibleBackendOptions;
  private readonly sessions = new Map<string, OpenAICompatibleSession>();
  private readonly clientEventHandlers = new Map<string, Set<Function>>();
  private connected = false;

  constructor(options: OpenAICompatibleBackendOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    let OpenAI: typeof import('openai').OpenAI;
    try {
      ({ default: { OpenAI } } = await import('openai') as any);
      // Handle both CJS and ESM shapes
      if (!OpenAI) {
        const mod = await import('openai');
        OpenAI = (mod as any).OpenAI ?? (mod as any).default?.OpenAI;
      }
    } catch {
      throw new Error(
        '[open-squad-sdk] OpenAICompatibleBackend requires the `openai` package. ' +
        'Run: npm install openai'
      );
    }

    this.openai = new OpenAI({
      baseURL: this.options.baseUrl,
      apiKey: this.options.apiKey ?? 'no-key',
      defaultHeaders: this.options.defaultHeaders,
    });
    this.connected = true;
  }

  async stop(): Promise<Error[]> {
    this.connected = false;
    this.sessions.clear();
    return [];
  }

  async forceStop(): Promise<void> {
    await this.stop();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createSession(config: SquadSessionConfig): Promise<any> {
    const sessionId = config.sessionId ?? randomUUID();
    const model = config.model ?? this.options.defaultModel ?? 'gpt-4o-mini';
    const systemPrompt = (config.systemMessage as any)?.content;

    const session = new OpenAICompatibleSession(sessionId, this.openai, model, systemPrompt);
    this.sessions.set(sessionId, session);

    this.emitClientEvent({ type: 'session.created', sessionId });
    return session;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async resumeSession(sessionId: string, config: SquadSessionConfig): Promise<any> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    // If not in memory, create a fresh session with the same ID
    return this.createSession({ ...config, sessionId });
  }

  async listSessions(): Promise<SquadSessionMetadata[]> {
    return Array.from(this.sessions.values()).map(s => s.getMetadata());
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.close();
      this.sessions.delete(sessionId);
      this.emitClientEvent({ type: 'session.deleted', sessionId });
    }
  }

  async getLastSessionId(): Promise<string | undefined> {
    const ids = Array.from(this.sessions.keys());
    return ids[ids.length - 1];
  }

  async ping(message = 'ping'): Promise<{ message: string; timestamp: number; protocolVersion?: number }> {
    return { message, timestamp: Date.now(), protocolVersion: 1 };
  }

  async getStatus(): Promise<SquadGetStatusResponse> {
    return { version: '1.0.0', protocolVersion: 1 };
  }

  async getAuthStatus(): Promise<SquadGetAuthStatusResponse> {
    // For local LLMs the key is empty — we treat that as authenticated
    const hasKey = !!this.options.apiKey && this.options.apiKey !== 'no-key';
    const isLocal = this.options.baseUrl.includes('localhost') ||
                    this.options.baseUrl.includes('127.0.0.1') ||
                    this.options.baseUrl.includes('10.');
    return {
      isAuthenticated: hasKey || isLocal,
      authType: hasKey ? 'api-key' : undefined,
      host: this.options.baseUrl,
    };
  }

  async listModels(): Promise<SquadModelInfo[]> {
    try {
      const response = await this.openai.models.list();
      return response.data.map(m => ({
        id: m.id,
        name: m.id,
        capabilities: {
          supports: { vision: false, reasoningEffort: false },
          limits: { max_context_window_tokens: 128_000 },
        },
      }));
    } catch {
      return [];
    }
  }

  on<K extends SquadClientEventType>(
    eventTypeOrHandler: K | SquadClientEventHandler,
    handler?: (event: SquadClientEvent & { type: K }) => void
  ): () => void {
    const key = typeof eventTypeOrHandler === 'string' ? eventTypeOrHandler : '__any__';
    const fn = typeof eventTypeOrHandler === 'function' ? eventTypeOrHandler : handler!;
    if (!this.clientEventHandlers.has(key)) {
      this.clientEventHandlers.set(key, new Set());
    }
    this.clientEventHandlers.get(key)!.add(fn);
    return () => this.clientEventHandlers.get(key)?.delete(fn);
  }

  private emitClientEvent(event: SquadClientEvent): void {
    this.clientEventHandlers.get(event.type)?.forEach(h => h(event));
    this.clientEventHandlers.get('__any__')?.forEach(h => h(event));
  }
}
