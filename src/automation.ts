import { useEffect, useRef, useState } from 'react';
import type { DndState } from '../shared/dnd';
import {
  BatteryWatcher, isAwayEvent, isBackEvent, isLowBattery, noticeForAudioDevices, noticeForSystem, noticeOffline, noticeOnline,
  type Notice, type SystemKind,
} from '../shared/notices';
import { ActivityTracker, TipEngine, type TipFrequency } from '../shared/proactive';
import { isRaining, type WeatherState } from '../shared/weather';
import { api, isMock } from './api';

/** Do-not-disturb state, kept in sync with the main process. */
export function useDnd(): DndState {
  const [state, setState] = useState<DndState>({ active: false });
  useEffect(() => {
    let alive = true;
    api.dnd.get().then((s) => { if (alive) setState(s); });
    const off = api.on('dnd:state', (s: DndState) => setState(s));
    return () => { alive = false; off(); };
  }, []);
  return state;
}

/** The weather for where you are (undefined until the first reading). */
export function useWeather(): WeatherState | undefined {
  const [state, setState] = useState<WeatherState>();
  useEffect(() => {
    let alive = true;
    api.weather.get().then((s) => { if (alive) setState(s); });
    const off = api.on('weather:state', (s: WeatherState) => setState(s));
    return () => { alive = false; off(); };
  }, []);
  return state;
}

export interface ActiveNotice extends Notice {
  id: number;
  at: number;
}

/**
 * What she is currently saying about the computer or a tip. A new notice replaces the old one and
 * disappears by itself after its duration.
 */
export function useNoticeState() {
  const [notice, setNotice] = useState<ActiveNotice>();
  const timer = useRef<number | undefined>(undefined);
  const counter = useRef(0);
  const push = (n: Notice) => {
    window.clearTimeout(timer.current);
    setNotice({ ...n, id: ++counter.current, at: Date.now() });
    timer.current = window.setTimeout(() => setNotice(undefined), n.ms);
  };
  const clear = () => { window.clearTimeout(timer.current); setNotice(undefined); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { notice, push, clear };
}

interface BatteryManager extends EventTarget { level: number; charging: boolean }

export interface SystemHooks {
  /** She should doze off right now (screen locked, computer going to sleep). */
  onAway(): void;
  /** Someone is back (unlocked, woke up). */
  onBack(): void;
}

/**
 * Reacts to the computer: lock and unlock, sleep and wake, charging, low battery, the network, and
 * audio devices coming and going. Returns whether the battery is low (so animations can calm down).
 */
export function useSystemNotices(enabled: boolean, push: (n: Notice) => void, hooks: SystemHooks): boolean {
  const [lowPower, setLowPower] = useState(false);
  const pushRef = useRef(push);
  pushRef.current = push;
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  // power and session events from the main process
  useEffect(() => {
    if (!enabled) return;
    return api.on('system', ({ kind }: { kind: SystemKind }) => {
      if (isAwayEvent(kind)) hooksRef.current.onAway();
      if (isBackEvent(kind)) hooksRef.current.onBack();
      const n = noticeForSystem(kind);
      if (n) pushRef.current(n);
    });
  }, [enabled]);

  // battery
  useEffect(() => {
    if (!enabled || isMock || typeof (navigator as { getBattery?: unknown }).getBattery !== 'function') { setLowPower(false); return; }
    let battery: BatteryManager | undefined;
    const watcher = new BatteryWatcher();
    const read = () => {
      if (!battery) return;
      const reading = { level: battery.level, charging: battery.charging };
      setLowPower(isLowBattery(reading));
      const n = watcher.update(reading);
      if (n) pushRef.current(n);
    };
    let cancelled = false;
    (navigator as unknown as { getBattery(): Promise<BatteryManager> }).getBattery().then((b) => {
      if (cancelled) return;
      battery = b;
      b.addEventListener('levelchange', read);
      b.addEventListener('chargingchange', read);
      read();
    }).catch(() => undefined);
    return () => { cancelled = true; battery?.removeEventListener('levelchange', read); battery?.removeEventListener('chargingchange', read); };
  }, [enabled]);

  // network
  useEffect(() => {
    if (!enabled || isMock) return;
    const offline = () => pushRef.current(noticeOffline());
    const online = () => pushRef.current(noticeOnline());
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  }, [enabled]);

  // audio devices
  useEffect(() => {
    if (!enabled || isMock || !navigator.mediaDevices?.enumerateDevices) return;
    let count: number | undefined;
    const check = async () => {
      try {
        const n = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput').length;
        if (count !== undefined) { const notice = noticeForAudioDevices(count, n); if (notice) pushRef.current(notice); }
        count = n;
      } catch { /* no access to devices */ }
    };
    void check();
    navigator.mediaDevices.addEventListener('devicechange', check);
    return () => navigator.mediaDevices.removeEventListener('devicechange', check);
  }, [enabled]);

  return enabled && lowPower;
}

const TIPS_KEY = 'lumi.tips.v1';

export interface TipInput {
  enabled: boolean;
  frequency: TipFrequency;
  idleSeconds: number;
  /** Do not disturb, a focus session, a meeting, asleep: say nothing. */
  quiet: boolean;
  weather?: WeatherState;
  /** An event with a place starts within a few hours. */
  eventSoon: boolean;
}

/** Gentle, rare tips: water, stretching, resting your eyes, bedtime, rain. */
export function useTips(input: TipInput, push: (n: Notice) => void) {
  const tracker = useRef(new ActivityTracker());
  const engine = useRef<TipEngine>(null as unknown as TipEngine);
  if (!engine.current) {
    let saved: ConstructorParameters<typeof TipEngine>[1];
    try { saved = JSON.parse(localStorage.getItem(TIPS_KEY) ?? 'null') ?? undefined; } catch { saved = undefined; }
    engine.current = new TipEngine(Math.random, saved, input.frequency);
  }
  const latest = useRef(input);
  latest.current = input;
  const pushRef = useRef(push);
  pushRef.current = push;

  // measure continuous use from the idle readings the main process sends
  useEffect(() => { tracker.current.update(Date.now(), input.idleSeconds); }, [input.idleSeconds]);
  useEffect(() => { engine.current.setFrequency(input.frequency); }, [input.frequency]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cur = latest.current;
      if (!cur.enabled) return;
      const tip = engine.current.consider({
        now: Date.now(),
        activeMinutes: tracker.current.minutes,
        hour: new Date().getHours(),
        quiet: cur.quiet,
        rainSoon: isRaining(cur.weather?.condition) && cur.eventSoon,
      });
      if (!tip) return;
      try { localStorage.setItem(TIPS_KEY, JSON.stringify(engine.current.serialize())); } catch { /* private mode */ }
      pushRef.current({ line: tip.text, tone: 'happy', action: tip.action, ms: 14_000 });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
}
