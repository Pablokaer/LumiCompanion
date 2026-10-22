import { EventEmitter } from 'node:events';
import type { OllamaSetupState, OllamaStatus, Settings } from '../../shared/types';
import { ensureOllama, ollamaStatus, startedByLumi, stopOllama } from './ollama';

/** The message every AI feature gives when it needs the AI and it is off. */
export const AI_OFF_MESSAGE = 'The local AI is off. Click “Start AI” in Chat first.';

export interface LocalAiDeps {
  getSettings(): Pick<Settings, 'ollamaUrl' | 'ollamaModel' | 'autoSetupOllama'>;
  /** Installs a missing Ollama or model, then starts it (OllamaSetup). */
  setup(baseUrl: string, model: string): Promise<OllamaSetupState>;
  /** Automatic setup can be switched off for tests and development (LUMI_NO_AUTOSETUP). */
  allowSetup?: boolean;
  status?: typeof ollamaStatus;
  ensure?: typeof ensureOllama;
  stop?: typeof stopOllama;
  startedByLumi?: typeof startedByLumi;
}

/**
 * The local AI (Ollama) as one thing that is on or off. It is the only module that starts or stops
 * Ollama, and every feature asks it instead of deciding by itself:
 * - `start()` / `stop()`: the Start AI / Stop AI buttons (and an explicit AI action, such as "Draft reply").
 * - `require()`: a feature that cannot work without the AI throws `AI_OFF_MESSAGE` when it is off.
 * - `isOn()`: a feature that only uses the AI if it happens to be on.
 * - `stopForQuit()`: quitting turns off a server Lumi started.
 * Emits 'state' (OllamaStatus) after every start and stop, so the window can follow.
 */
export class LocalAi extends EventEmitter {
  private readonly status: typeof ollamaStatus;
  private readonly ensure: typeof ensureOllama;
  private readonly stopServer: typeof stopOllama;
  private readonly ours: typeof startedByLumi;

  constructor(private deps: LocalAiDeps) {
    super();
    this.status = deps.status ?? ollamaStatus;
    this.ensure = deps.ensure ?? ensureOllama;
    this.stopServer = deps.stop ?? stopOllama;
    this.ours = deps.startedByLumi ?? startedByLumi;
  }

  private get url() { return this.deps.getSettings().ollamaUrl; }

  state(): Promise<OllamaStatus> { return this.status(this.url); }

  async isOn(): Promise<boolean> { return (await this.state()).running; }

  async require(): Promise<void> {
    if (!(await this.isOn())) throw new Error(AI_OFF_MESSAGE);
  }

  /** Turns the AI on: with automatic setup, a missing Ollama or model is installed first. Never throws. */
  async start(): Promise<OllamaStatus> {
    const s = this.deps.getSettings();
    if (s.autoSetupOllama && this.deps.allowSetup !== false) await this.deps.setup(s.ollamaUrl, s.ollamaModel);
    else await this.ensure(s.ollamaUrl);
    const status = await this.state();
    this.emit('state', status);
    return status;
  }

  /** Turns the AI off. `external`: the server was not started by Lumi, so only its model was unloaded. */
  async stop(): Promise<{ status: OllamaStatus; external: boolean }> {
    const { external } = await this.stopServer(this.url);
    const status = await this.state();
    this.emit('state', status);
    return { status, external };
  }

  /** On quit: stops the server Lumi started, or returns undefined when there is nothing to stop. */
  stopForQuit(): Promise<unknown> | undefined {
    return this.ours(this.url) ? this.stopServer(this.url) : undefined;
  }
}
