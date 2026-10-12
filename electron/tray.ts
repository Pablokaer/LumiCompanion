import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { nextLocalHour } from '../shared/dnd';
import type { DndState } from '../shared/dnd';
import { getSettings, updateSettings } from './store';
import { applyWidgetMode, getWindow, toggleWindow } from './window';

let tray: Tray | null = null;

/** What the tray needs to know about, and control, do-not-disturb. */
export interface DndControls {
  state(): DndState;
  set(untilMs: number | null): void;
}
let dndControls: DndControls | undefined;

const REASON_TEXT = { manual: 'paused by you', fullscreen: 'a full-screen app is on', meeting: 'you are in a meeting' } as const;

export function createTray(onSettingsChanged: () => void, controls?: DndControls) {
  dndControls = controls;
  const iconPath = path.join(__dirname, '../../assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Lumi – your space companion');
  tray.on('click', () => toggleWindow());
  rebuildTrayMenu(onSettingsChanged);
  return tray;
}

export function rebuildTrayMenu(onSettingsChanged: () => void) {
  if (!tray) return;
  const s = getSettings();
  const set = (patch: Parameters<typeof updateSettings>[0]) => {
    updateSettings(patch);
    onSettingsChanged();
    rebuildTrayMenu(onSettingsChanged);
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Show / hide ${s.mascotName}`, accelerator: 'CmdOrCtrl+Shift+L', click: () => toggleWindow() },
      { type: 'separator' },
      ...(dndControls ? [dndMenu(dndControls)] : []),
      {
        label: 'Always on top',
        type: 'checkbox',
        checked: s.widgetMode === 'onTop',
        click: (item) => { set({ widgetMode: item.checked ? 'onTop' : 'desktop' }); applyWidgetMode(getSettings().widgetMode); },
      },
      {
        label: 'Start with my computer',
        type: 'checkbox',
        checked: s.launchAtLogin,
        click: (item) => set({ launchAtLogin: item.checked }),
      },
      { label: 'Reload', click: () => getWindow()?.reload() },
      { type: 'separator' },
      { label: 'Quit Lumi', role: 'quit', click: () => app.quit() },
    ]),
  );
}

function dndMenu(c: DndControls): Electron.MenuItemConstructorOptions {
  const state = c.state();
  return {
    label: state.active ? `Do not disturb — ${state.reason ? REASON_TEXT[state.reason] : 'on'}` : 'Do not disturb',
    submenu: [
      { label: 'Quiet for 1 hour', click: () => c.set(Date.now() + 3_600_000) },
      { label: 'Quiet until tomorrow morning', click: () => c.set(nextLocalHour(Date.now(), 8)) },
      { label: 'Turn the pause off', enabled: state.active && state.reason === 'manual', click: () => c.set(null) },
    ],
  };
}
