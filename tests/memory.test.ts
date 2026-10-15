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

import { applyMemoryFlags } from '../electron/memoryFlags';

describe('memory switches', () => {
  const fake = () => {
    const calls: string[] = [];
    return { calls, app: { disableHardwareAcceleration: () => calls.push('no-gpu'), commandLine: { appendSwitch: (n: string) => calls.push(n) } } };
  };

  it('turns on software rendering and low-end mode on Windows', () => {
    const { app, calls } = fake();
    expect(applyMemoryFlags(app, 'win32', {})).toBe(true);
    expect(calls).toEqual(['no-gpu', 'enable-low-end-device-mode']);
  });

  it('leaves other platforms alone, and can be switched off', () => {
    const a = fake();
    expect(applyMemoryFlags(a.app, 'darwin', {})).toBe(false);
    expect(applyMemoryFlags(a.app, 'linux', {})).toBe(false);
    expect(applyMemoryFlags(a.app, 'win32', { LUMI_HARDWARE_ACCELERATION: '1' })).toBe(false);
    expect(a.calls).toEqual([]);
  });
});
