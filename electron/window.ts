import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { WidgetMode, WidgetView, WindowMode } from '../shared/types';
import { getSavedPosition, getSettings, savePosition } from './store';

const EXPANDED_SIZE = { width: 400, height: 640 };
const COMPACT_SIZES: Record<WidgetView, { width: number; height: number }> = {
  mascot: { width: 240, height: 300 },
  month: { width: 340, height: 440 },
  day: { width: 310, height: 420 },
};

export const sizeFor = (m: WindowMode, view: WidgetView = getSettings().widgetView) =>
  m === 'expanded' ? EXPANDED_SIZE : COMPACT_SIZES[view] ?? COMPACT_SIZES.mascot;

const MARGIN = 24;
let win: BrowserWindow | null = null;
let mode: WindowMode = 'compact';
let peekTimer: NodeJS.Timeout | undefined;

export const getWindow = () => win;

export function createWidgetWindow(): BrowserWindow {
  const { width, height } = sizeFor(mode);
  const { x, y } = initialPosition(width);

  win = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    title: 'Lumi',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  applyWidgetMode(getSettings().widgetMode);

  // Never let the renderer open new windows or navigate away.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'file://')) e.preventDefault();
  });

  win.on('moved', () => {
    if (!win) return;
    const b = win.getBounds();
    // Store the top-right anchor so the widget grows towards the screen centre.
    savePosition({ x: b.x + b.width, y: b.y });
  });
  win.once('ready-to-show', () => win?.showInactive());
  win.on('closed', () => { win = null; });

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '../../dist/index.html'));
  return win;
}

function initialPosition(width: number) {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = getSavedPosition();
  if (saved) {
    const visible = screen.getAllDisplays().some((d) =>
      saved.x > d.workArea.x + 40 && saved.x <= d.workArea.x + d.workArea.width + 1 &&
      saved.y >= d.workArea.y && saved.y < d.workArea.y + d.workArea.height - 40);
    if (visible) return { x: saved.x - width, y: saved.y };
  }
  return { x: area.x + area.width - width - MARGIN, y: area.y + MARGIN };
}

/** Switches between the small mascot widget and the full panel, keeping the top-right corner fixed. */
export function setWindowMode(next: WindowMode) {
  if (!win || next === mode) return;
  mode = next;
  resizeWindow();
  if (next === 'expanded') win.focus();
}

/** Re-applies the size for the current mode, e.g. after the widget view setting changed. */
export function refreshWindowSize() {
  if (win) resizeWindow();
}

function resizeWindow() {
  if (!win) return;
  const b = win.getBounds();
  const { width, height } = sizeFor(mode);
  const area = screen.getDisplayMatching(b).workArea;
  const right = b.x + b.width;
  const x = Math.max(area.x, Math.min(right - width, area.x + area.width - width));
  const y = Math.max(area.y, Math.min(b.y, area.y + area.height - height));
  win.setBounds({ x, y, width, height }, true);
}

/**
 * 'desktop': sits behind normal windows like a desktop widget, on every workspace.
 * 'onTop':   floats above all windows.
 */
export function applyWidgetMode(widgetMode: WidgetMode) {
  if (!win) return;
  const onTop = widgetMode === 'onTop';
  win.setAlwaysOnTop(onTop, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: onTop });
  win.setSkipTaskbar(true);
}

/** Briefly brings the widget to the front (e.g. for a reminder) without stealing focus. */
export function peek(durationMs = 20_000) {
  if (!win) return;
  if (!win.isVisible()) win.showInactive();
  win.setAlwaysOnTop(true, 'floating');
  win.moveTop();
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => applyWidgetMode(getSettings().widgetMode), durationMs);
}

export function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else { win.show(); win.focus(); }
}
