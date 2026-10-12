import { useEffect, useMemo, useRef } from 'react';
import { resolveSkin, SHAPE_INFO, useAppearance } from '../appearance';
import type { MascotAction } from '../behavior';
import { dancePose, type DancePose } from '../dance';
import { prefersReducedMotion, useLife } from '../mascotLife';
import { blendPose, easeWeights, initialWeights, poseToCss, type BaseMotion } from '../motion';
import { beatPhase } from '../music/beat';
import { beatClock } from '../music/listener';
import { Gear } from './gear';
import { ShapeBack, ShapeBody, ShapeFront } from './shapes';

export type Mood = 'idle' | 'happy' | 'alert' | 'thinking' | 'sleepy';

interface Props {
  mood?: Mood;
  size?: number;
  onClick?: () => void;
  title?: string;
}

/** Below this size (chat avatars) the star stays a still little icon. */
const MIN_LIVELY_SIZE = 34;

const HAPPY_ACTIONS: MascotAction[] = ['smile', 'hop', 'wave', 'spin', 'wiggle', 'cheer', 'twinkle', 'hum'];

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
  const smooth = lively && !reduced;
  const calm = mood === 'alert' || mood === 'thinking';
  const sleeping = lively && life.sleeping && !calm;
  const dancing = lively && life.dancing && !calm;
  // Actions are never cut short: they finish their own animation, which starts and ends at rest.
  const action: MascotAction = lively ? life.action : 'none';

  let face: Mood = mood;
  if (sleeping) face = 'sleepy';
  else if (dancing || (mood === 'idle' && HAPPY_ACTIONS.includes(action))) face = 'happy';
  const yawning = action === 'stretch' || action === 'wake';

  const target: BaseMotion = sleeping ? 'breathe' : dancing ? 'dance' : MOOD_MOTION[mood];
  const targetRef = useRef(target);
  targetRef.current = target;

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
      body.style.transform = poseToCss(blendPose(weights, now / 1000, dance));

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
    return () => { cancelAnimationFrame(raf); body.style.transform = ''; resetArms(); };
  }, [smooth]);

  const classes = [
    'mascot', `mood-${face}`, smooth ? 'js-motion' : '',
    sleeping ? 'is-sleeping' : '', dancing ? 'is-dancing' : '', action === 'hum' ? 'is-humming' : '',
  ].filter(Boolean).join(' ');

  return (
    <button type="button" className={classes} style={{ width: size, height: size }} onClick={onClick} aria-label={title ?? 'Lumi'} title={title}>
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

              <Face mood={face} yawning={yawning} />
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
function Face({ mood, yawning }: { mood: Mood; yawning: boolean }) {
  const part = (on: boolean) => `face-part${on ? ' on' : ''}`;
  const happyEyes = mood === 'happy' || yawning;
  const sleepyEyes = mood === 'sleepy' && !yawning;
  const open = (m: Mood) => mood === m && !yawning;
  const blush = mood === 'alert' ? 0.3 : 0.55;

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
        <g key={m} className={part(open(m))}>
          <g className="mascot-eyes">
            {[82, 118].map((cx) => {
              const alert = m === 'alert';
              const glance = m === 'thinking' ? { x: 3, y: -5 } : { x: 0, y: 0 };
              return (
                <g key={cx}>
                  <ellipse cx={cx} cy="106" rx={alert ? 10 : 9} ry={alert ? 13 : 11} fill="#fff" />
                  <g className="pupil" style={{ transform: `translate(${glance.x}px, ${glance.y}px)` }}>
                    <circle cx={cx} cy="107" r={alert ? 5 : 6} fill={INK} />
                    <circle cx={cx + 2.5} cy="104" r="2" fill="#fff" />
                  </g>
                </g>
              );
            })}
          </g>
        </g>
      ))}

      {/* mouth */}
      <ellipse className={part(yawning)} cx="100" cy="130" rx="8" ry="10" fill={INK} />
      <path className={part(open('idle'))} d="M90 126 q10 9 20 0" stroke={INK} strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <g className={part(mood === 'happy' && !yawning)}>
        <path d="M86 122 q14 20 28 0 z" fill={INK} />
        <path d="M93 129 q7 6 14 0 q-7 -3 -14 0z" fill="#ff7aa8" />
      </g>
      <ellipse className={part(open('alert'))} cx="100" cy="130" rx="6" ry="7.5" fill={INK} />
      <path className={part(open('thinking'))} d="M93 128 q6 -3 14 1" stroke={INK} strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <ellipse className={part(sleepyEyes)} cx="100" cy="128" rx="4" ry="3" fill={INK} />
    </g>
  );
}
