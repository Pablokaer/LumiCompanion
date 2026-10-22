import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { IpcCall, IpcChannel, LumiEvent, LumiEvents } from '../shared/types';

/**
 * Registers the main-process side of an invoke channel. The channel and the handler's arguments and
 * result are checked against LumiApi (through IpcChannels). The arguments come from the renderer, so
 * handlers still validate them at run time; the types only keep both sides in step.
 */
export function handle<K extends IpcChannel>(
  channel: K,
  handler: (e: IpcMainInvokeEvent, ...args: IpcCall<K>['args']) => IpcCall<K>['result'] | Awaited<IpcCall<K>['result']>,
) {
  ipcMain.handle(channel, handler as (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown);
}

/** Sends a push event, with the payload its channel promises in LumiEvents. */
export function sendEvent<K extends LumiEvent>(to: WebContents | undefined, channel: K, ...payload: LumiEvents[K] extends undefined ? [] : [LumiEvents[K]]) {
  to?.send(channel, ...payload);
}
