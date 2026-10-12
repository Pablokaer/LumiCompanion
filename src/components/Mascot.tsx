import { useEffect, useMemo, useRef } from 'react';
import { resolveSkin, SHAPE_INFO, useAppearance } from '../appearance';
import type { MascotAction } from '../behavior';
import { dancePose, type DancePose } from '../dance';
import { prefersReducedMotion, useLife } from '../mascotLife';
import { aimTarget, blendPose, easeWeights, initialWeights, poseToCss, smoothAim, type BaseMotion } from '../motion';
import { beatPhase } from '../music/beat';
import { beatClock } from '../music/listener';
import { faceFor, type Mood, type Mouth } from '../face';
import { BlinkController, GazeController, pointer } from '../gaze';
import { Gear } from './gear';
import { ShapeBack, ShapeBody, ShapeFront } from './shapes';

export type { Mood } from '../face';

interface Props {
  mood?: Mood;
  size?: number;
  onClick?: () => void;
  title?: string;
}

/** Below this size (chat avatars) the star stays a still little icon. */
const MIN_LIVELY_SIZE = 34;

/** The background movement that goes with each mood. */
const MOOD_MOTION: Record<Mood, BaseMotion> = {
  idle: 'float', happy: 'bounce', alert: 'shake', thinking: 'thinkFloat', sleepy: 'slowFloat',
};

/** Lumi, the little blue star. She sleeps when you are away, dances to music and keeps herself busy. */
export function Mascot({ mood = 'idle', size = 140, onClick, title }: Props) {
  const id = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  const { skin, customColor, shape, accessories } = useAppearance();
  const info = SHAPE_INFO[shape] ?? SHAPE_INFO.star;
  const life = useLife();
  const reduced = useMemo(prefersReducedMotion, []);
  const stops = resolveSkin(skin, customColor).stops;
  const fill = `url(#body-${id})`;
  const shapeProps = { shape, fill, uid: id, stops };

  const lively = size >= MIN_LIVELY_SIZE;
  const quiet = lively && life.quiet;
  const smooth = lively && !reduced && !quiet;
  const calm = mood === 'alert' || mood === 'thinking';
  const sleeping = lively && life.sleeping && !calm;
  const dancing = lively && life.dancing && !calm;
  // Actions are never cut short: they finish their own animation, which starts and ends at rest.
  const action: MascotAction = lively && !quiet ? life.action : 'none';

  const reaction = lively && !calm && !sleeping ? life.reaction : 'none';
  const face = faceFor({ mood, sleeping, dancing, action, reaction, tone: quiet ? undefined : life.noticeTone });
  const yawning = action === 'stretch' || action === 'wake';

  const target: BaseMotion = reaction !== 'none' ? reaction : sleeping ? 'breathe' : dancing ? 'dance' : MOOD_MOTION[mood];
  const targetRef = useRef(target);
  targetRef.current = target;
  const lookRef = useRef({ follow: life.followMouse, alert: mood === 'alert', reaction });
  lookRef.current = { follow: life.followMouse, alert: mood === 'alert', reaction };
  const reactionStart = useRef(0);
  useEffect(() => { reactionStart.current = performance.now(); }, [life.reactionKey]);

  const svgRef = useRef<SVGSVGElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const armL = useRef<SVGGElement>(null);
  const armR = useRef<SVGGElement>(null);

  // One loop poses the whole body: floating, breathing, bouncing, shaking and dancing are blended with
  // weights that glide toward the current state, so every change of state is a smooth crossfade.
  useEffect(() => {
    const body = bodyRef.current;
    if (!smooth || !body) return;
    const weights = initialWeights(targetRef.current);
    const clock = { originMs: 0, periodSec: 0.5, valid: false }; // remembered so the dance can wind down gracefully
    let armsShown = false;
    let last = performance.now();
    let raf = 0;
    const gaze = new GazeController();
    const aim = { x: 0, y: 0 };
    const blink = new BlinkController();
    const svg = svgRef.current;
    const pupils = svg ? [...svg.querySelectorAll<SVGGElement>('.pupil')] : [];
    const eyes = svg ? [...svg.querySelectorAll<SVGGElement>('.mascot-eyes')] : [];

    const resetArms = () => {
      for (const arm of [armL.current, armR.current]) if (arm) { arm.style.transform = ''; arm.style.opacity = ''; }
      armsShown = false;
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      easeWeights(weights, targetRef.current, dt);
      if (beatClock.active) {
        clock.originMs = beatClock.originMs; clock.periodSec = beatClock.periodSec; clock.valid = true;
        svgRef.current?.style.setProperty('--beat', `${clock.periodSec}s`);
      }
      let dance: DancePose | undefined;
      if (weights.dance > 1e-3 && clock.valid) {
        const { phase, count } = beatPhase(now, clock.originMs, clock.periodSec);
        dance = dancePose(phase, count);
      }
      const look = lookRef.current;
      const box = svg?.getBoundingClientRect();
      const cursor = box && pointer.known ? { dx: pointer.x - (box.left + box.width / 2), dy: pointer.y - (box.top + box.height * 0.54) } : undefined;
      // which way the mouse is, for reactions that lean toward it, away from it, or lunge at it
      smoothAim(aim, cursor ? aimTarget(cursor.dx, cursor.dy) : { x: 0, y: 0 }, dt);
      body.style.transform = poseToCss(blendPose(weights, now / 1000, dance, { aimX: aim.x, aimY: aim.y, since: (now - reactionStart.current) / 1000 }));

      // eyes: follow the mouse or wander, widen when it is close, and blink at random
      const mode = look.reaction === 'shy' ? 'avert' : look.reaction === 'bite' ? 'lock' : undefined;
      const g = gaze.update(dt, now, { cursor, cursorIdleMs: now - pointer.at, follow: look.follow, alert: look.alert, mode });
      const lid = `scaleY(${(1 - 0.94 * blink.update(now)).toFixed(3)})`;
      for (const p of pupils) {
        const v = p.dataset.variant;
        const x = v === 'thinking' ? 2.5 + g.x * 0.4 : v === 'alert' ? g.x * 0.3 : g.x;
        const y = v === 'thinking' ? -4 + g.y * 0.3 : v === 'alert' ? g.y * 0.3 : g.y;
        const s = v === 'alert' ? 0.85 : 1 + 0.14 * g.near;
        p.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(3)})`;
      }
      for (const e of eyes) e.style.transform = lid;

      const w = weights.dance;
      if (dance && w > 0.01) {
        if (armL.current) { armL.current.style.transform = `rotate(${dance.armL * w}deg)`; armL.current.style.opacity = String(Math.min(1, w * 3)); }
        if (armR.current) { armR.current.style.transform = `rotate(${-dance.armR * w}deg)`; armR.current.style.opacity = String(Math.min(1, w * 3)); }
        armsShown = true;
      } else if (armsShown) {
        resetArms();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      body.style.transform = '';
      resetArms();
      for (const p of pupils) p.style.transform = '';
      for (const e of eyes) e.style.transform = '';
    };
  }, [smooth]);

  const classes = [
    'mascot', `mood-${face.mouth}`, smooth ? 'js-motion' : '',
    sleeping ? 'is-sleeping' : '', dancing ? 'is-dancing' : '', action === 'hum' ? 'is-humming' : '',
    life.noticeTone === 'worried' && !quiet && reaction === 'none' ? 'is-worried' : '',
    reaction === 'giggle' ? 'is-giggling' : reaction === 'shy' ? 'is-shy' : reaction === 'purr' ? 'is-purring' : reaction === 'bite' ? 'is-biting' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={classes}
      style={{ width: size, height: size }}
      onClick={onClick}
      onPointerEnter={lively ? () => life.interact.enter() : undefined}
      onPointerMove={lively ? (e) => life.interact.move(e.clientX, e.clientY) : undefined}
      onPointerLeave={lively ? () => life.interact.leave() : undefined}
      aria-label={title ?? 'Lumi'}
      title={title}
    >
      <svg ref={svgRef} viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id={`body-${id}`} cx="40%" cy="35%" r="75%">
            <stop offset="0%" stopColor={stops[0]} />
            <stop offset="35%" stopColor={stops[1]} />
            <stop offset="75%" stopColor={stops[2]} />
            <stop offset="100%" stopColor={stops[3]} />
          </radialGradient>
          <radialGradient id={`halo-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--mascot-halo)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--mascot-halo)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle className="mascot-halo" cx="100" cy="108" r="96" fill={`url(#halo-${id})`} />

        <g className="mascot-sparkles" fill="#d9f0ff">
          <path className="spark s1" d="M28 46 l3 9 9 3 -9 3 -3 9 -3 -9 -9 -3 9 -3z" />
          <path className="spark s2" d="M170 40 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z" />
          <path className="spark s3" d="M176 150 l2.5 7 7 2.5 -7 2.5 -2.5 7 -2.5 -7 -7 -2.5 7 -2.5z" />
        </g>

        {lively && (
          <g className="mascot-notes" fontSize="32" fontWeight="700" fill="var(--star)">
            <text className="note n1" x="14" y="92">♪</text>
            <text className="note n2" x="166" y="76">♫</text>
            <text className="note n3" x="150" y="38">♪</text>
          </g>
        )}

        {lively && (
          <g className="mascot-hearts" fontSize="30" fontWeight="700" fill="#ff6b9d">
            <text className="heart h1" x="150" y="76">♥</text>
            <text className="heart h2" x="26" y="84">♥</text>
            <text className="heart h3" x="164" y="112">♥</text>
          </g>
        )}
        {lively && <path className="mascot-sweat" d="M152 56 q9 15 0 22 q-9 -7 0 -22z" fill="#7cc8ff" stroke="#3a8fd8" strokeWidth="2" />}

        {/* No `key` here: remounting would throw away the pose the loop above is writing. */}
        <g className={`mascot-act act-${action}`}>
          <g className="mascot-dance" ref={bodyRef}>
            <g className="mascot-body">
              <ShapeBack {...shapeProps} />
              {/* arms: tucked away until she waves, cheers, stretches or dances */}
              <g className="mascot-arm arm-l" ref={armL}>
                <ellipse cx={42 - info.armSpread} cy="138" rx="9" ry="17" fill={fill} stroke={fill} strokeWidth="6" />
              </g>
              <g className="mascot-arm arm-r" ref={armR}>
                <ellipse cx={158 + info.armSpread} cy="138" rx="9" ry="17" fill={fill} stroke={fill} strokeWidth="6" />
              </g>

              <ShapeBody {...shapeProps} />
              {/* shine */}
              <ellipse cx="76" cy="72" rx="14" ry="7" fill="#fff" opacity="0.45" transform="rotate(-30 76 72)" />
              <ShapeFront {...shapeProps} />

              <Face eyes={face.eyes} mouth={face.mouth} brows={!!face.brows} yawning={yawning} smoothLook={smooth} />
              <Gear accessories={accessories} topOffset={info.topOffset} />
            </g>
          </g>
        </g>

        {lively && (
          <g className="mascot-zzz" fontWeight="700" fill="var(--star)">
            <text className="z z1" x="140" y="60" fontSize="22">z</text>
            <text className="z z2" x="152" y="42" fontSize="28">Z</text>
            <text className="z z3" x="166" y="22" fontSize="34">Z</text>
          </g>
        )}
      </svg>
    </button>
  );
}

const INK = '#0b1a4a';

/** Every expression is always drawn and faded in or out, so changing mood is a crossfade rather than a swap. */
function Face({ eyes, mouth, brows, yawning, smoothLook }: { eyes: Mood; mouth: Mouth; brows: boolean; yawning: boolean; smoothLook: boolean }) {
  const part = (on: boolean) => `face-part${on ? ' on' : ''}`;
  const happyEyes = eyes === 'happy' || yawning; // a yawn squints the eyes shut for a moment
  const sleepyEyes = eyes === 'sleepy' && !yawning;
  const openEyes = (m: Mood) => eyes === m && !yawning;
  const openMouth = (m: Mouth) => mouth === m && !yawning;
  const blush = eyes === 'alert' ? 0.3 : 0.55;

  return (
    <g className="mascot-face">
      {/* cheeks */}
      <ellipse className="cheek" cx="68" cy="126" rx="10" ry="6" fill="#ff8fc8" style={{ opacity: blush }} />
      <ellipse className="cheek" cx="132" cy="126" rx="10" ry="6" fill="#ff8fc8" style={{ opacity: blush }} />

      {/* eyes */}
      <g className={part(happyEyes)} stroke={INK} strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M74 110 q8 -11 16 0" />
        <path d="M110 110 q8 -11 16 0" />
      </g>
      <g className={part(sleepyEyes)} stroke={INK} strokeWidth="4.5" strokeLinecap="round" fill="none">
        <path d="M74 108 q8 7 16 0" />
        <path d="M110 108 q8 7 16 0" />
      </g>
      {(['idle', 'alert', 'thinking'] as const).map((m) => (
        <g key={m} className={part(openEyes(m))}>
          <g className="mascot-eyes">
            {[82, 118].map((cx) => {
              const alert = m === 'alert';
              const glance = m === 'thinking' ? { x: 3, y: -5 } : { x: 0, y: 0 };
              return (
                <g key={cx}>
                  <ellipse cx={cx} cy="106" rx={alert ? 10 : 9} ry={alert ? 13 : 11} fill="#fff" />
                  <g className="pupil" data-variant={m} style={smoothLook ? undefined : { transform: `translate(${glance.x}px, ${glance.y}px)` }}>
                    <circle cx={cx} cy="107" r={alert ? 5 : 6} fill={INK} />
                    <circle cx={cx + 2.5} cy="104" r="2" fill="#fff" />
                  </g>
                </g>
              );
            })}
          </g>
        </g>
      ))}

      {/* fierce little eyebrows, for when she is about to bite */}
      <g className={part(brows)} stroke={INK} strokeWidth="4.5" strokeLinecap="round" fill="none">
        <path d="M68 88 L92 98" />
        <path d="M132 88 L108 98" />
      </g>

      {/* mouth */}
      <g className={part(openMouth('laugh'))}>
        <path d="M82 118 q18 36 36 0 z" fill={INK} />
        <ellipse cx="100" cy="134" rx="9" ry="5" fill="#ff7aa8" />
      </g>
      <path className={part(openMouth('shy'))} d="M89 129 q5.5 -6 11 0 t11 0" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />
      <path className={part(openMouth('purr'))} d="M87 124 q6.5 9 13 0 q6.5 9 13 0" stroke={INK} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <g className={`${part(openMouth('chomp'))} chomp-mouth`}>
        <path d="M79 117 q21 38 42 0 z" fill={INK} />
        <path d="M85 118 l5 8 5 -8 M105 118 l5 8 5 -8" fill="#fff" stroke="#fff" strokeWidth="1" strokeLinejoin="round" />
      </g>
      <ellipse className={part(yawning)} cx="100" cy="130" rx="8" ry="10" fill={INK} />
      <path className={part(openMouth('idle'))} d="M90 126 q10 9 20 0" stroke={INK} strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <g className={part(openMouth('happy'))}>
        <path d="M86 122 q14 20 28 0 z" fill={INK} />
        <path d="M93 129 q7 6 14 0 q-7 -3 -14 0z" fill="#ff7aa8" />
      </g>
      <ellipse className={part(openMouth('alert'))} cx="100" cy="130" rx="6" ry="7.5" fill={INK} />
      <path className={part(openMouth('thinking'))} d="M93 128 q6 -3 14 1" stroke={INK} strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <ellipse className={part(openMouth('sleepy'))} cx="100" cy="128" rx="4" ry="3" fill={INK} />
    </g>
  );
}
