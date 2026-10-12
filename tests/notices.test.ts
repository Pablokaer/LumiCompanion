import { describe, expect, it } from 'vitest';
import {
  BatteryWatcher, isAwayEvent, isBackEvent, isLowBattery, noticeForAudioDevices, noticeForSystem, noticeOffline, noticeOnline,
  type SystemKind,
} from '../shared/notices';

describe('system events', () => {
  it('greets you when you come back, and says nothing when you leave', () => {
    expect(noticeForSystem('unlock-screen')).toMatchObject({ tone: 'happy', action: 'wave' });
    expect(noticeForSystem('resume')?.line).toContain('again');
    expect(noticeForSystem('lock-screen')).toBeUndefined();
    expect(noticeForSystem('suspend')).toBeUndefined();
  });

  it('reacts to being plugged in and unplugged', () => {
    expect(noticeForSystem('on-ac')).toMatchObject({ tone: 'happy' });
    expect(noticeForSystem('on-battery')).toMatchObject({ tone: 'neutral', action: 'none' });
  });

  it('tells away events from back events', () => {
    const kinds: SystemKind[] = ['lock-screen', 'unlock-screen', 'suspend', 'resume', 'on-ac', 'on-battery'];
    expect(kinds.filter(isAwayEvent)).toEqual(['lock-screen', 'suspend']);
    expect(kinds.filter(isBackEvent)).toEqual(['unlock-screen', 'resume']);
  });

  it('every notice has readable text and a sensible duration', () => {
    for (const n of [noticeForSystem('unlock-screen'), noticeForSystem('on-ac'), noticeForSystem('on-battery'), noticeOffline(), noticeOnline()]) {
      expect(n!.line.length).toBeGreaterThan(5);
      expect(n!.ms).toBeGreaterThanOrEqual(3000);
      expect(n!.ms).toBeLessThanOrEqual(12_000);
    }
    expect(noticeOffline().tone).toBe('worried');
    expect(noticeOnline().tone).toBe('happy');
  });
});

describe('audio devices', () => {
  it('notices a device appearing or disappearing, but not the same count', () => {
    expect(noticeForAudioDevices(2, 3)?.line).toContain('connected');
    expect(noticeForAudioDevices(3, 2)?.line).toContain('disconnected');
    expect(noticeForAudioDevices(2, 2)).toBeUndefined();
  });
});

describe('battery', () => {
  it('warns once at 20% and once at 10%, never in between', () => {
    const w = new BatteryWatcher();
    expect(w.update({ level: 0.5, charging: false })).toBeUndefined();
    expect(w.update({ level: 0.25, charging: false })).toBeUndefined();
    expect(w.update({ level: 0.2, charging: false })?.line).toContain('20%');
    expect(w.update({ level: 0.19, charging: false })).toBeUndefined();
    expect(w.update({ level: 0.15, charging: false })).toBeUndefined();
    expect(w.update({ level: 0.1, charging: false })).toMatchObject({ tone: 'worried', line: expect.stringContaining('10%') });
    expect(w.update({ level: 0.09, charging: false })).toBeUndefined();
    expect(w.update({ level: 0.05, charging: false })).toBeUndefined();
  });

  it('jumps straight to the urgent warning if it is first seen very low', () => {
    expect(new BatteryWatcher().update({ level: 0.08, charging: false })?.line).toContain('please');
  });

  it('never warns while charging, and warns again after a real recharge', () => {
    const w = new BatteryWatcher();
    expect(w.update({ level: 0.08, charging: true })).toBeUndefined();
    expect(w.update({ level: 0.2, charging: false })).toBeDefined();
    expect(w.update({ level: 0.5, charging: false })).toBeUndefined(); // recovered
    expect(w.update({ level: 0.19, charging: false })).toBeDefined(); // and low again later
  });

  it('plugging in resets the warnings', () => {
    const w = new BatteryWatcher();
    expect(w.update({ level: 0.1, charging: false })).toBeDefined();
    w.update({ level: 0.1, charging: true });
    expect(w.update({ level: 0.1, charging: false })).toBeDefined();
  });

  it('knows when to save power', () => {
    expect(isLowBattery({ level: 0.2, charging: false })).toBe(true);
    expect(isLowBattery({ level: 0.2, charging: true })).toBe(false);
    expect(isLowBattery({ level: 0.5, charging: false })).toBe(false);
  });
});
