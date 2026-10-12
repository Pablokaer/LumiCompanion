import { BrowserWindow, globalShortcut, screen } from 'electron';
import path from 'node:path';

/**
 * Quick capture: a global shortcut opens a small floating window where you type something like
 * "lunch tomorrow 1pm" and confirm. The window is the same app (route `#quick`), created on first use.
 */

const WIDTH = 560;
const HEIGHT = 400;

export class QuickCapture {
  private win: BrowserWindow | null = null;
  private registered?: string;

  /**
   * Registers (or unregisters) the global shortcut. Resolves with an error message when the shortcut
   * is invalid or already taken by another program.
   */
  apply(enabled: boolean, accelerator: string): { ok: boolean; error?: string } {
    if (this.registered) { globalShortcut.unregister(this.registered); this.registered = undefined; }
    if (!enabled) return { ok: true };
    const accel = accelerator.trim();
    if (!accel) return { ok: false, error: 'Type a shortcut, for example Ctrl+Shift+Space.' };
    try {
      if (!globalShortcut.register(accel, () => this.toggle())) {
        return { ok: false, error: `“${accel}” is already used by another program. Try a different shortcut.` };
      }
    } catch {
      return { ok: false, error: `“${accel}” is not a valid shortcut. Use something like CommandOrControl+Shift+Space.` };
    }
    this.registered = accel;
    return { ok: true };
  }

  toggle() {
    if (this.win?.isVisible()) this.hide(); else this.show();
  }

  show() {
    const win = this.win && !this.win.isDestroyed() ? this.win : this.create();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    win.setBounds({ x: Math.round(area.x + (area.width - WIDTH) / 2), y: Math.round(area.y + area.height * 0.16), width: WIDTH, height: HEIGHT });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.show();
    win.focus();
    // Tell the page to clear itself and focus the input (it may still be loading the first time).
    const reset = () => win.webContents.send('quick:show');
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', reset); else reset();
  }

  hide() {
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  dispose() {
    if (this.registered) globalShortcut.unregister(this.registered);
    this.registered = undefined;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
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
      title: 'Lumi quick capture',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('blur', () => win.hide());
    win.on('closed', () => { this.win = null; });
    if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#quick`);
    else void win.loadFile(path.join(__dirname, '../../dist/index.html'), { hash: 'quick' });
    this.win = win;
    return win;
  }
}
