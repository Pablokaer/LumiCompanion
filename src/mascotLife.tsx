import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, isMock } from './api';
import { nextDelayMs, pickAction, sleepThresholdSeconds, WAKE_MS, type MascotAction } from './behavior';
import type { NoticeAction, NoticeTone } from '../shared/notices';
import { InteractionController, type Reaction } from './interaction';
import { beatClock, MusicListener, type MusicSnapshot } from './music/listener';
import { isHidden, subscribePower } from './power';

declare global {
  interface Window { __lumiMusicStart?: () => Promise<void> }
}

/** Everything the star's body needs to know to look alive. */
export interface LifeState {
  action: MascotAction;
  actionKey: number;
  sleeping: boolean;
  dancing: boolean;
  /** Eyes follow the mouse cursor. */
  followMouse: boolean;
  /** Do not disturb or low battery: calm and still. */
  quiet: boolean;
  /** The full panel is open (she keeps her full frame rate). */
  expanded: boolean;
  /** How she feels about the notice she is showing, if any. */
  noticeTone?: NoticeTone;
  /** How she is reacting to the mouse passing over her (laugh, blush, purr, bite). */
  reaction: Reaction;
  reactionKey: number;
  reactionLine: string;
  /** Pointer events from her body, which drive the reactions. */
  interact: { enter(): void; leave(): void; move(x: number, y: number): void };
  bpm: number;
  musicStatus: MusicSnapshot['status'];
  musicError?: string;
}

const NO_INTERACTION = { enter() {}, leave() {}, move() {} };

export const IDLE_LIFE: LifeState = {
  action: 'none', actionKey: 0, sleeping: false, dancing: false, followMouse: true, quiet: false, expanded: false, reaction: 'none', reactionKey: 0, reactionLine: '',
  interact: NO_INTERACTION, bpm: 0, musicStatus: 'off',
};

const LifeContext = createContext<LifeState>(IDLE_LIFE);
export const LifeProvider = LifeContext.Provider;
export const useLife = () => useContext(LifeContext);

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- music ----------

const listener = new MusicListener();

/**
 * Starts or stops listening to the computer's audio. The main process triggers the start (it can simulate
 * the user gesture Chromium demands); a real click is a fallback. The browser preview has no audio to
 * capture, so `?music=1` fakes a 120 BPM track there.
 */
export function useMusic(enabled: boolean): MusicSnapshot {
  const [snapshot, setSnapshot] = useState<MusicSnapshot>(listener.snapshot);
  useEffect(() => listener.subscribe(setSnapshot), []);

  useEffect(() => {
    if (isMock) {
      if (enabled && new URLSearchParams(location.search).get('music') === '1') listener.simulate(120);
      else listener.stop();
      return;
    }
    if (!enabled) { listener.stop(); delete window.__lumiMusicStart; return; }
    window.__lumiMusicStart = () => listener.start();
    void api.music.requestStart();
    const onPointer = () => { if (listener.snapshot.status === 'off') void listener.start(); };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [enabled]);

  return snapshot;
}

// ---------- behaviour ----------

interface LifeInput {
  /** Spontaneous actions on/off. */
  lively: boolean;
  sleepAfterMinutes: number;
  idleSeconds: number;
  music: MusicSnapshot;
  reactToMusic: boolean;
  followMouse: boolean;
  petReactions: boolean;
  /** Do not disturb or low battery. */
  quiet?: boolean;
  /** The full panel is open. */
  expanded?: boolean;
  /** A notice she is currently showing: its tone and the action it asks for. */
  notice?: { tone: NoticeTone; action: NoticeAction };
  /** Something important is going on (reminder, chat, focus): stay calm. */
  calm: boolean;
}

/** Decides what the star is doing: dancing, sleeping, waking up, or a random little action. */
export function useMascotLife({ lively, sleepAfterMinutes, idleSeconds, music, reactToMusic, followMouse, petReactions, calm: busy, quiet = false, expanded = false, notice }: LifeInput): LifeState {
  const calm = busy || quiet;
  const reduced = useMemo(prefersReducedMotion, []);
  const dancing = reactToMusic && music.playing && !quiet;
  const sleeping = !dancing && idleSeconds >= sleepThresholdSeconds(sleepAfterMinutes);

  // Wake up with a stretch when the computer is used again.
  const [waking, setWaking] = useState(false);
  const wasSleeping = useRef(false);
  useEffect(() => {
    if (wasSleeping.current && !sleeping) {
      setWaking(true);
      const t = window.setTimeout(() => setWaking(false), WAKE_MS);
      wasSleeping.current = sleeping;
      return () => window.clearTimeout(t);
    }
    wasSleeping.current = sleeping;
  }, [sleeping]);

  // Spontaneous actions: pick one, let it play, rest a moment, repeat.
  const [action, setAction] = useState<MascotAction>('none');
  const [actionKey, setActionKey] = useState(0);
  const active = lively && !reduced && !sleeping && !dancing && !calm && !waking;
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    // One long-lived loop. When she becomes busy (reminder, chat, dancing…) an action already playing is
    // allowed to finish, because every action starts and ends at rest; only the next one is held back.
    let alive = true;
    let timer = 0;
    let last: MascotAction | undefined;
    const rest = (ms: number) => { timer = window.setTimeout(begin, ms); };
    const begin = () => {
      if (!alive) return;
      if (!activeRef.current) { rest(1000); return; }
      const next = pickAction(Math.random, last);
      last = next.action;
      setAction(next.action);
      setActionKey((k) => k + 1);
      timer = window.setTimeout(() => { if (!alive) return; setAction('none'); rest(nextDelayMs(Math.random)); }, next.durationMs);
    };
    rest(nextDelayMs(Math.random));
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);

  // Reactions to the mouse passing over her. The controller is plain logic; this wires it to React.
  const controller = useRef<InteractionController>(null as unknown as InteractionController);
  if (!controller.current) controller.current = new InteractionController();
  const ctl = controller.current;
  const [reactionState, setReactionState] = useState({ reaction: 'none' as Reaction, key: 0, line: '' });
  const sync = useCallback(() => setReactionState({ reaction: ctl.reaction, key: ctl.key, line: ctl.line }), [ctl]);
  // Browser preview only: ?reaction=bite pins a reaction (and then the mouse no longer triggers real ones).
  const forcedReaction = isMock ? (new URLSearchParams(location.search).get('reaction') as Reaction | null) : null;
  const reactable = lively && petReactions && !sleeping && !forcedReaction;
  const reactableRef = useRef(reactable);
  reactableRef.current = reactable;
  // The controller only needs a tick while the pointer is on her or a reaction is playing, and not at all
  // while nobody can see her (a reaction that ends meanwhile is settled by the first tick after she is seen).
  const ticker = useRef({ start() {} });
  const interact = useMemo(() => ({
    enter: () => { if (reactableRef.current && ctl.enter(performance.now())) sync(); ticker.current.start(); },
    leave: () => { ctl.leave(performance.now()); },
    move: (x: number, y: number) => { if (reactableRef.current && ctl.move(performance.now(), x, y)) sync(); },
  }), [ctl, sync]);
  useEffect(() => {
    let timer = 0;
    const wanted = () => ctl.needsTick && (reactableRef.current || ctl.reaction !== 'none'); // asleep: nothing to tick
    const stop = () => { window.clearInterval(timer); timer = 0; };
    const tick = () => {
      if (isHidden()) { stop(); return; }
      if (ctl.tick(performance.now())) sync();
      if (!wanted()) stop();
    };
    const start = () => { if (!timer && wanted() && !isHidden()) timer = window.setInterval(tick, 100); };
    ticker.current.start = start;
    const offPower = subscribePower(start);
    document.addEventListener('visibilitychange', start);
    return () => { stop(); offPower(); document.removeEventListener('visibilitychange', start); ticker.current.start = () => {}; };
  }, [ctl, sync]);
  useEffect(() => { if (!reactable && ctl.reset()) sync(); }, [reactable, ctl, sync]);

  // Browser preview only: ?action=wave pins an action so each animation can be inspected.
  const forced = isMock ? (new URLSearchParams(location.search).get('action') as MascotAction | null) : null;

  return {
    action: forced ?? (notice && notice.action !== 'none' && !quiet ? notice.action : waking ? 'wake' : action),
    actionKey,
    sleeping,
    dancing,
    followMouse,
    quiet,
    expanded,
    noticeTone: notice?.tone,
    reaction: forcedReaction ?? reactionState.reaction,
    reactionKey: reactionState.key,
    reactionLine: forcedReaction ? `(${forcedReaction})` : reactionState.line,
    interact,
    bpm: music.bpm,
    musicStatus: music.status,
    musicError: music.error,
  };
}

export { beatClock };
