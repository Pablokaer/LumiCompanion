import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { hexToHsv, hsvToHex, hsvToRgb, normalizeHex, rgbToHsv, type HSV } from '../../shared/color';

interface Props {
  /** The saved colour: the "current" half of the preview swatch. */
  value: string;
  swatches: string[];
  /** Called continuously while dragging or typing, to preview the colour without saving it. */
  onLive(hex: string): void;
  /** Called when a pick is finished: save it. */
  onCommit(hex: string): void;
  onSaveSwatch(hex: string): void;
  onRemoveSwatch(hex: string): void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A Photoshop-style colour picker: a saturation/brightness square, a hue strip, R/G/B and hex fields,
 * a new-versus-current swatch, an eyedropper for picking from anywhere on screen, and saved swatches.
 * Covers the whole RGB range. Fully usable from the keyboard.
 */
export function ColorPicker({ value, swatches, onLive, onCommit, onSaveSwatch, onRemoveSwatch }: Props) {
  const [hsv, setHsvState] = useState<HSV>(() => hexToHsv(value));
  const hsvRef = useRef(hsv);
  const [hexText, setHexText] = useState(value);
  const [hexFocused, setHexFocused] = useState(false);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'sv' | 'hue' | null>(null);

  const hex = hsvToHex(hsv);
  const rgb = hsvToRgb(hsv);
  const canDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  const setHsv = (next: HSV) => { hsvRef.current = next; setHsvState(next); };

  // Follow the saved colour when it changes from outside (a swatch, a preset, another window).
  useEffect(() => {
    const incoming = normalizeHex(value);
    if (incoming && incoming !== hsvToHex(hsvRef.current)) setHsv(hexToHsv(incoming));
  }, [value]);
  useEffect(() => { if (!hexFocused) setHexText(hex); }, [hex, hexFocused]);

  const live = (next: HSV) => { setHsv(next); onLive(hsvToHex(next)); };
  const commit = () => onCommit(hsvToHex(hsvRef.current));

  // ---- saturation / brightness square ----
  const pickSv = (e: PointerEvent) => {
    const r = svRef.current!.getBoundingClientRect();
    live({ ...hsvRef.current, s: clamp((e.clientX - r.left) / r.width, 0, 1), v: 1 - clamp((e.clientY - r.top) / r.height, 0, 1) });
  };
  const onSvKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const c = hsvRef.current;
    const next = e.key === 'ArrowLeft' ? { ...c, s: clamp(c.s - step, 0, 1) }
      : e.key === 'ArrowRight' ? { ...c, s: clamp(c.s + step, 0, 1) }
      : e.key === 'ArrowUp' ? { ...c, v: clamp(c.v + step, 0, 1) }
      : e.key === 'ArrowDown' ? { ...c, v: clamp(c.v - step, 0, 1) } : undefined;
    if (!next) return;
    e.preventDefault();
    live(next);
    onCommit(hsvToHex(next));
  };

  // ---- hue strip ----
  const pickHue = (e: PointerEvent) => {
    const r = hueRef.current!.getBoundingClientRect();
    live({ ...hsvRef.current, h: clamp((e.clientX - r.left) / r.width, 0, 1) * 360 });
  };
  const onHueKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const c = hsvRef.current;
    const next = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? { ...c, h: clamp(c.h - step, 0, 360) }
      : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? { ...c, h: clamp(c.h + step, 0, 360) } : undefined;
    if (!next) return;
    e.preventDefault();
    live(next);
    onCommit(hsvToHex(next));
  };

  const down = (kind: 'sv' | 'hue') => (e: PointerEvent) => {
    dragging.current = kind;
    e.currentTarget.setPointerCapture(e.pointerId);
    (kind === 'sv' ? pickSv : pickHue)(e);
  };
  const move = (kind: 'sv' | 'hue') => (e: PointerEvent) => { if (dragging.current === kind) (kind === 'sv' ? pickSv : pickHue)(e); };
  const up = (e: PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    commit();
  };

  // ---- number fields ----
  const setChannel = (channel: 'r' | 'g' | 'b', raw: string) => {
    const n = clamp(Math.round(Number(raw) || 0), 0, 255);
    const next = rgbToHsv({ ...rgb, [channel]: n });
    // keep the hue when the colour becomes grey, black or white (hue is undefined there)
    live(next.s === 0 || next.v === 0 ? { ...next, h: hsvRef.current.h } : next);
  };

  const applyHexText = () => {
    const n = normalizeHex(hexText);
    if (n) { live(hexToHsv(n)); onCommit(n); } else setHexText(hex);
  };

  const dropper = async () => {
    try {
      const result = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open();
      const n = normalizeHex(result.sRGBHex);
      if (n) { live(hexToHsv(n)); onCommit(n); }
    } catch { /* cancelled with Escape */ }
  };

  const pure = `hsl(${hsv.h} 100% 50%)`;

  return (
    <div className="color-picker">
      <div className="cp-main">
        <div
          ref={svRef}
          className="cp-sv"
          style={{ backgroundColor: pure }}
          role="application"
          tabIndex={0}
          aria-label={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%. Use the arrow keys.`}
          onPointerDown={down('sv')}
          onPointerMove={move('sv')}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={onSvKey}
        >
          <span className="cp-handle" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
        </div>
      </div>

      <div
        ref={hueRef}
        className="cp-hue"
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={down('hue')}
        onPointerMove={move('hue')}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={onHueKey}
      >
        <span className="cp-handle" style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }} />
      </div>

      <div className="cp-fields">
        <div className="cp-compare" aria-label={`New colour ${hex}, current ${normalizeHex(value)}`}>
          <span style={{ background: hex }}>New</span>
          <button type="button" style={{ background: value }} onClick={() => { live(hexToHsv(value)); onCommit(normalizeHex(value) ?? hex); }} title="Go back to the current colour">Current</button>
        </div>
        {(['r', 'g', 'b'] as const).map((c) => (
          <label key={c} className="cp-num">
            <span>{c.toUpperCase()}</span>
            <input
              type="number" min={0} max={255} value={rgb[c]}
              onChange={(e) => setChannel(c, e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
            />
          </label>
        ))}
        <label className="cp-hex">
          <span>#</span>
          <input
            value={hexFocused ? hexText.replace(/^#/, '') : hex.slice(1)}
            maxLength={7}
            spellCheck={false}
            aria-label="Hex colour"
            onFocus={() => { setHexFocused(true); setHexText(hex.slice(1)); }}
            onChange={(e) => {
              setHexText(e.target.value);
              const n = normalizeHex(e.target.value);
              if (n) live(hexToHsv(n));
            }}
            onBlur={() => { setHexFocused(false); applyHexText(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        </label>
      </div>

      <div className="cp-actions">
        {canDropper && <button type="button" className="pill-btn ghost small" onClick={dropper}>💧 Pick from screen</button>}
        <button type="button" className="pill-btn ghost small" onClick={() => onSaveSwatch(hex)} disabled={swatches.includes(hex)}>＋ Save colour</button>
      </div>

      {swatches.length > 0 && (
        <div className="cp-swatches" role="list" aria-label="Saved colours">
          {swatches.map((c) => (
            <span key={c} className="cp-swatch" role="listitem">
              <button
                type="button" style={{ background: c }} aria-label={`Use ${c}`} title={c}
                className={c === hex ? 'on' : ''}
                onClick={() => { live(hexToHsv(c)); onCommit(c); }}
                onContextMenu={(e) => { e.preventDefault(); onRemoveSwatch(c); }}
              />
              <button type="button" className="cp-remove" aria-label={`Remove ${c}`} onClick={() => onRemoveSwatch(c)}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
