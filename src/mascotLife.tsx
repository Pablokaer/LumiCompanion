import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, isMock } from './api';
import { nextDelayMs, pickAction, sleepThresholdSeconds, WAKE_MS, type MascotAction } from './behavior';
import { InteractionController, type Reaction } from './interaction';
import { beatClock, MusicListener, type MusicSnapshot } from './music/listener';

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
  action: 'none', actionKey: 0, sleeping: false, dancing: false, followMouse: true, reaction: 'none', reactionKey: 0, reactionLine: '',
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
  /** Something important is going on (reminder, chat, focus): stay calm. */
  calm: boolean;
}

/** Decides what the star is doing: dancing, sleeping, waking up, or a random little action. */
export function useMascotLife({ lively, sleepAfterMinutes, idleSeconds, music, reactToMusic, followMouse, petReactions, calm }: LifeInput): LifeState {
  const reduced = useMemo(prefersReducedMotion, []);
  const dancing = reactToMusic && music.playing;
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
  const interact = useMemo(() => ({
    enter: () => { if (reactableRef.current && ctl.enter(performance.now())) sync(); },
    leave: () => { ctl.leave(performance.now()); },
    move: (x: number, y: number) => { if (reactableRef.current && ctl.move(performance.now(), x, y)) sync(); },
  }), [ctl, sync]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (ctl.tick(performance.now())) sync(); }, 100);
    return () => window.clearInterval(timer);
  }, [ctl, sync]);
  useEffect(() => { if (!reactable && ctl.reset()) sync(); }, [reactable, ctl, sync]);

  // Browser preview only: ?action=wave pins an action so each animation can be inspected.
  const forced = isMock ? (new URLSearchParams(location.search).get('action') as MascotAction | null) : null;

  return {
    action: forced ?? (waking ? 'wake' : action),
    actionKey,
    sleeping,
    dancing,
    followMouse,
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
