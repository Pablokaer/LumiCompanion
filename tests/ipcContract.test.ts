import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The compiler checks every channel name and argument against LumiApi (IpcChannels), but it cannot see
// whether main.ts actually registers a handler for each one. These checks read the two sources.
const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const names = (text: string, call: string) => [...text.matchAll(new RegExp(`\\b${call}\\('([^']+)'`, 'g'))].map((m) => m[1]).sort();

describe('the IPC contract', () => {
  const preload = read('electron/preload.ts');
  const main = read('electron/main.ts');

  it('has a main-process handler for every call the preload exposes, and no handler nobody calls', () => {
    const invoked = names(preload, 'invoke');
    expect(invoked.length).toBeGreaterThan(40);
    expect(names(main, 'handle')).toEqual(invoked);
  });

  it('registers each channel once', () => {
    const handled = names(main, 'handle');
    expect(new Set(handled).size).toBe(handled.length);
  });
});
