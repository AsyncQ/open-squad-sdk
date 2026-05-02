/**
 * CopilotBackend — wraps @github/copilot-sdk.
 *
 * Identical behaviour to the original SquadClient. Only loads when
 * @github/copilot-sdk is installed — throws a clear error otherwise.
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
} from '../types.js';

export interface CopilotBackendOptions {
  cliPath?: string;
  cliArgs?: string[];
  cwd?: string;
  port?: number;
  useStdio?: boolean;
  cliUrl?: string;
  logLevel?: 'error' | 'warning' | 'info' | 'debug' | 'all' | 'none';
  env?: Record<string, string>;
  githubToken?: string;
  useLoggedInUser?: boolean;
}

export class CopilotBackend implements ISquadBackend {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;

  constructor(options: CopilotBackendOptions = {}) {
    let CopilotClient: any;
    try {
      // Dynamic import so the package stays optional
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ CopilotClient } = require('@github/copilot-sdk'));
    } catch {
      throw new Error(
        '[open-squad-sdk] CopilotBackend requires @github/copilot-sdk. ' +
        'Run: npm install @github/copilot-sdk'
      );
    }

    this.client = new CopilotClient({
      cliPath: options.cliPath,
      cliArgs: options.cliArgs ?? [],
      cwd: options.cwd ?? process.cwd(),
      port: options.port ?? 0,
      useStdio: options.useStdio ?? true,
      cliUrl: options.cliUrl,
      logLevel: options.logLevel ?? 'debug',
      autoStart: false,
      autoRestart: false,
      env: options.env ?? (process.env as Record<string, string>),
      githubToken: options.githubToken,
      useLoggedInUser: options.useLoggedInUser ?? (options.githubToken ? false : true),
    });
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<Error[]> {
    return await this.client.stop();
  }

  async forceStop(): Promise<void> {
    await this.client.forceStop();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createSession(config: SquadSessionConfig): Promise<any> {
    return await this.client.createSession(config);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async resumeSession(sessionId: string, config: SquadSessionConfig): Promise<any> {
    return await this.client.resumeSession(sessionId, config);
  }

  async listSessions(): Promise<SquadSessionMetadata[]> {
    const sessions = await this.client.listSessions();
    return sessions.map((s: any): SquadSessionMetadata => ({
      sessionId: s.sessionId,
      startTime: s.startTime,
      modifiedTime: s.modifiedTime,
      summary: s.summary,
      isRemote: s.isRemote,
      context: s.context,
    }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.client.deleteSession(sessionId);
  }

  async getLastSessionId(): Promise<string | undefined> {
    return await this.client.getLastSessionId();
  }

  async ping(message?: string): Promise<{ message: string; timestamp: number; protocolVersion?: number }> {
    return await this.client.ping(message);
  }

  async getStatus(): Promise<SquadGetStatusResponse> {
    const raw = await this.client.getStatus();
    return { version: raw.version, protocolVersion: raw.protocolVersion };
  }

  async getAuthStatus(): Promise<SquadGetAuthStatusResponse> {
    const raw = await this.client.getAuthStatus();
    return {
      isAuthenticated: raw.isAuthenticated,
      authType: raw.authType,
      host: raw.host,
      login: raw.login,
      statusMessage: raw.statusMessage,
    };
  }

  async listModels(): Promise<SquadModelInfo[]> {
    const models = await this.client.listModels();
    return models.map((m: any): SquadModelInfo => ({
      id: m.id,
      name: m.name,
      capabilities: m.capabilities,
      policy: m.policy,
      billing: m.billing,
      supportedReasoningEfforts: m.supportedReasoningEfforts,
      defaultReasoningEffort: m.defaultReasoningEffort,
    }));
  }

  on<K extends SquadClientEventType>(
    eventTypeOrHandler: K | SquadClientEventHandler,
    handler?: (event: SquadClientEvent & { type: K }) => void
  ): () => void {
    if (typeof eventTypeOrHandler === 'string' && handler) {
      return this.client.on(eventTypeOrHandler, handler);
    }
    return this.client.on(eventTypeOrHandler as SquadClientEventHandler);
  }
}
