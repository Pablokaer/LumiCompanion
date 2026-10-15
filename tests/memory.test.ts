import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const windows: { destroyed: boolean; visible: boolean; handlers: Record<string, () => void> }[] = [];

vi.mock('electron', () => {
  class BrowserWindow {
    state = { destroyed: false, visible: false, handlers: {} as Record<string, () => void> };
    webContents = { setWindowOpenHandler() {}, on() {}, send() {}, isLoading: () => false, once() {} };
    constructor() { windows.push(this.state); }
    on(e: string, fn: () => void) { this.state.handlers[e] = fn; }
    loadFile() { return Promise.resolve(); }
    loadURL() { return Promise.resolve(); }
    setBounds() {}
    setAlwaysOnTop() {}
    show() { this.state.visible = true; }
    focus() {}
    hide() { this.state.visible = false; }
    isVisible() { return this.state.visible; }
    isDestroyed() { return this.state.destroyed; }
    destroy() { this.state.destroyed = true; this.state.visible = false; }
  }
  return {
    BrowserWindow,
    globalShortcut: { register: () => true, unregister() {} },
    screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
  };
});

import { IDLE_DESTROY_MS, QuickCapture } from '../electron/quickCapture';
import { unloadRecognizer } from '../electron/voice/transcribe';
import { KEEP_ALIVE, ollamaChat } from '../electron/agent/ollama';

describe('quick capture window', () => {
  beforeEach(() => { vi.useFakeTimers(); windows.length = 0; });
  afterEach(() => vi.useRealTimers());

  it('is closed after a while unused, and built again on the next use', () => {
    const q = new QuickCapture();
    q.show();
    expect(windows).toHaveLength(1);
    q.hide();
    vi.advanceTimersByTime(IDLE_DESTROY_MS + 10);
    expect(windows[0].destroyed).toBe(true);
    q.show();
    expect(windows).toHaveLength(2);
    expect(windows[1].visible).toBe(true);
  });

  it('is kept when it is used again before the timeout, and when it loses focus it still counts as hidden', () => {
    const q = new QuickCapture();
    q.show();
    windows[0].handlers.blur(); // clicking elsewhere hides it
    expect(windows[0].visible).toBe(false);
    vi.advanceTimersByTime(IDLE_DESTROY_MS - 1000);
    q.show();
    vi.advanceTimersByTime(IDLE_DESTROY_MS * 2);
    expect(windows[0].destroyed).toBe(false); // visible the whole time: never destroyed
    expect(windows).toHaveLength(1);
  });

  it('is destroyed after blur alone once the timeout passes', () => {
    const q = new QuickCapture();
    q.show();
    windows[0].handlers.blur();
    vi.advanceTimersByTime(IDLE_DESTROY_MS + 10);
    expect(windows[0].destroyed).toBe(true);
  });
});

describe('speech model', () => {
  it('has nothing to free before it was ever used', async () => {
    expect(await unloadRecognizer()).toBe(false);
  });
});

describe('ollama keep-alive', () => {
  it('asks Ollama to let the model go after a short idle time', async () => {
    let body: any;
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ message: { role: 'assistant', content: 'hi' } }) }; });
    await ollamaChat({ baseUrl: 'http://x', model: 'm', messages: [] });
    expect(body.keep_alive).toBe(KEEP_ALIVE);
    vi.unstubAllGlobals();
  });
});

import { applyMemoryFlags, lowMemoryEnabled, LOW_MEMORY_DISABLE_FEATURES } from '../electron/memoryFlags';

describe('memory switches', () => {
  const fake = () => {
    const calls: string[] = [];
    return { calls, app: { disableHardwareAcceleration: () => calls.push('no-gpu'), commandLine: { appendSwitch: (n: string, v?: string) => calls.push(v ? `${n}=${v}` : n) } } };
  };

  it('applies the whole low-memory set on Windows, merged with the features that are always off', () => {
    const { app, calls } = fake();
    expect(applyMemoryFlags(app, ['CalculateNativeWinOcclusion'], 'win32', {})).toBe(true);
    expect(calls).toContain('no-gpu');
    expect(calls).toContain('enable-low-end-device-mode');
    expect(calls).toContain('in-process-gpu');
    expect(calls).toContain(`disable-features=CalculateNativeWinOcclusion,${LOW_MEMORY_DISABLE_FEATURES.join(',')}`);
    expect(calls.find((c) => c.startsWith('enable-features='))).toMatch(/NetworkServiceInProcess2/);
    expect(calls.filter((c) => c.startsWith('disable-features=')).length).toBe(1); // Chromium keeps only one value
  });

  it('on other platforms only keeps the always-off features, unless LUMI_LOW_MEMORY=1', () => {
    const a = fake();
    expect(applyMemoryFlags(a.app, ['CalculateNativeWinOcclusion'], 'darwin', {})).toBe(false);
    expect(a.calls).toEqual(['disable-features=CalculateNativeWinOcclusion']);
    expect(lowMemoryEnabled('darwin', { LUMI_LOW_MEMORY: '1' })).toBe(true);
    expect(lowMemoryEnabled('linux', {})).toBe(false);
  });

  it('LUMI_HARDWARE_ACCELERATION=1 turns everything off, even where it was asked for', () => {
    expect(lowMemoryEnabled('win32', { LUMI_HARDWARE_ACCELERATION: '1' })).toBe(false);
    expect(lowMemoryEnabled('darwin', { LUMI_LOW_MEMORY: '1', LUMI_HARDWARE_ACCELERATION: '1' })).toBe(false);
  });
});
