import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RunningApp } from './harness';

let app: RunningApp;
beforeAll(async () => { app = await RunningApp.start(); });
afterAll(async () => { await app?.stop(); });

describe('the real app, signed out', () => {
  it('opens a window with the bridge and a first screen', async () => {
    await app.waitFor('!!window.lumi', 'the preload bridge');
    await app.waitFor("!!document.querySelector('.login, .mascot')", 'the first screen');
    expect(await app.eval('typeof window.lumi.dnd.get')).toBe('function');
  });

  it('is not quiet by default and can be paused and resumed', async () => {
    expect(await app.eval('window.lumi.dnd.get().then((s) => s.active)')).toBe(false);
    const paused = await app.eval<{ active: boolean; reason?: string }>('window.lumi.dnd.set(Date.now() + 3600000)');
    expect(paused).toMatchObject({ active: true, reason: 'manual' });
    expect(await app.eval('window.lumi.dnd.set(null).then((s) => s.active)')).toBe(false);
  });

  it('has defaults for the new options, and changes survive a read', async () => {
    const s = await app.eval<any>('window.lumi.settings.get()');
    expect(s).toMatchObject({ dndFullscreen: true, quickCapture: true, weather: true, seasonalLook: true, proactiveTips: true, reactToSystem: true, temperatureUnit: 'c' });
    await app.eval("window.lumi.settings.update({ temperatureUnit: 'f', weather: false }).then(() => 1)");
    expect(await app.eval('window.lumi.settings.get().then((x) => [x.temperatureUnit, x.weather])')).toEqual(['f', false]);
    await app.eval("window.lumi.settings.update({ temperatureUnit: 'c', weather: true }).then(() => 1)");
  });

  it('understands a sentence as an event, in English and in Portuguese', async () => {
    const en = await app.eval<any>("window.lumi.capture.parse('dentist next friday at 3pm')");
    expect(en).toMatchObject({ understood: true, via: 'rules' });
    expect(en.event.title.toLowerCase()).toContain('dentist');
    expect(en.event.start).toMatch(/T15:00/);
    const pt = await app.eval<any>("window.lumi.capture.parse('almoço com a Ana amanhã às 13h')");
    expect(pt.understood).toBe(true);
    expect(pt.event.start).toMatch(/T13:00/);
  });

  it('rejects a shortcut that cannot work', async () => {
    const bad = await app.eval<{ ok: boolean; error?: string }>("window.lumi.capture.setShortcut('not a shortcut')");
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
  });

  it('ignores links that are not https meeting links', async () => {
    await app.eval("window.lumi.window.openExternal('file:///C:/Windows/System32/calc.exe').then(() => 1)");
    await app.eval("window.lumi.window.openExternal('javascript:alert(1)').then(() => 1)");
  });

  it('keeps routines and news, and refuses what is not valid', async () => {
    expect(await app.eval('window.lumi.news.list().then((n) => n.length)')).toBe(0);
    const bad = await app.eval<string>("window.lumi.routines.save({ name: 'x', kind: 'site', target: 'not a site' }).then(() => 'saved', (e) => e.message)");
    expect(bad).toMatch(/website address/i);
    // Paused, so it does not go out to the internet.
    const list = await app.eval<any[]>("window.lumi.routines.save({ name: 'Akita', kind: 'site', target: 'akitaonrails.com', enabled: false })");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Akita', target: 'https://akitaonrails.com/', enabled: false, useAi: false });
    expect(await app.eval('window.lumi.routines.remove(' + JSON.stringify(list[0].id) + ').then((l) => l.length)')).toBe(0);
    await app.eval("window.lumi.news.open('nope').then(() => 1)"); // an unknown article opens nothing
  });
});

describe('the quick-capture screen', () => {
  it('turns a typed sentence into a filled-in event form', async () => {
    const url = (await app.currentUrl()).split('#')[0];
    await app.navigate(`${url}#quick`);
    await app.eval('location.reload()');
    await app.waitFor("!!document.querySelector('.quick-capture input')", 'the quick-capture input');
    await app.eval(`(() => {
      const input = document.querySelector('.quick-capture input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'team lunch tomorrow at 1pm');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`);
    await app.eval("document.querySelector('.quick-capture .primary-btn').click()");
    await app.waitFor("!!document.querySelector('.quick-capture .quick-add')", 'the event form');
    expect(await app.eval("document.querySelector('.quick-capture input[aria-label=\"Event title\"]').value.toLowerCase()")).toContain('team lunch');
    expect(await app.eval("document.querySelector('.quick-capture input[aria-label=\"Time\"]').value")).toBe('13:00');
  });
});
