import { describe, expect, it, vi } from 'vitest';
import { AI_OFF_MESSAGE, LocalAi, type LocalAiDeps } from '../electron/agent/localAi';
import type { OllamaStatus } from '../shared/types';

/** A pretend Ollama: on or off, started by Lumi or by somebody else. */
function fakeOllama({ running = false, ours = false, autoSetupOllama = true } = {}) {
  const world = { running, ours, calls: [] as string[] };
  const status = async (): Promise<OllamaStatus> => (world.running ? { running: true, models: ['m'] } : { running: false, models: [] });
  const deps: LocalAiDeps = {
    getSettings: () => ({ ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'm', autoSetupOllama }),
    setup: async () => { world.calls.push('setup'); world.running = true; world.ours = true; return { status: 'ready' }; },
    status,
    ensure: async () => { world.calls.push('ensure'); world.running = true; world.ours = true; return status(); },
    stop: async () => {
      world.calls.push('stop');
      const external = world.running && !world.ours;
      if (world.ours) { world.running = false; world.ours = false; return { stopped: true, external: false }; }
      return { stopped: false, external };
    },
    startedByLumi: () => world.ours,
  };
  return { world, ai: new LocalAi(deps), deps };
}

describe('the local AI', () => {
  it('is off until started, and features that need it say so in one way', async () => {
    const { ai } = fakeOllama();
    expect(await ai.isOn()).toBe(false);
    await expect(ai.require()).rejects.toThrow(AI_OFF_MESSAGE);
  });

  it('starts through the setup when automatic setup is on, and tells the window', async () => {
    const { ai, world } = fakeOllama();
    const heard = vi.fn();
    ai.on('state', heard);
    expect((await ai.start()).running).toBe(true);
    expect(world.calls).toEqual(['setup']);
    expect(heard).toHaveBeenCalledWith({ running: true, models: ['m'] });
    await expect(ai.require()).resolves.toBeUndefined();
  });

  it('only starts the server (no downloads) when automatic setup is off or not allowed', async () => {
    const off = fakeOllama({ autoSetupOllama: false });
    await off.ai.start();
    expect(off.world.calls).toEqual(['ensure']);
    const blocked = fakeOllama();
    const ai = new LocalAi({ ...blocked.deps, allowSetup: false });
    await ai.start();
    expect(blocked.world.calls).toEqual(['ensure']);
  });

  it('stops a server it started, and on quit only stops what it started', async () => {
    const { ai, world } = fakeOllama();
    expect(ai.stopForQuit()).toBeUndefined(); // nothing running yet
    await ai.start();
    const heard = vi.fn();
    ai.on('state', heard);
    expect(await ai.stop()).toEqual({ status: { running: false, models: [] }, external: false });
    expect(heard).toHaveBeenCalledWith({ running: false, models: [] });
    await ai.start();
    await ai.stopForQuit();
    expect(world.running).toBe(false);
  });

  it('leaves a server started outside Lumi running and says so', async () => {
    const { ai } = fakeOllama({ running: true, ours: false });
    expect(ai.stopForQuit()).toBeUndefined();
    const { status, external } = await ai.stop();
    expect(external).toBe(true);
    expect(status.running).toBe(true);
  });
});
