import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { getSettings, updateSettings } from './store';
import { applyWidgetMode, getWindow, toggleWindow } from './window';

let tray: Tray | null = null;

export function createTray(onSettingsChanged: () => void) {
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
