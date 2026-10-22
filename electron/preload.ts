// Runs in a sandboxed preload: only `electron` may be required here, so channel
// names are inlined and shared types are imported as types only. The types still
// check them: a channel missing from IpcChannels or LumiEvents does not compile.
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcCall, IpcChannel, LumiApi, LumiEvent } from '../shared/types';

// Every event must be listed (a Record over all of LumiEvents' keys), and nothing else.
const EVENT_NAMES: Record<LumiEvent, true> = {
  reminder: true, 'data:updated': true, 'agent:confirm': true, 'agent:status': true, 'auth:changed': true, 'settings:changed': true,
  'focus:changed': true, briefing: true, activity: true, 'update:state': true, cursor: true, 'dnd:state': true, 'weather:state': true,
  system: true, power: true, 'quick:show': true, 'ollama:setup': true, 'routines:updated': true, 'news:updated': true, 'ai:state': true,
};
const EVENTS = new Set<string>(Object.keys(EVENT_NAMES));

const invoke = <K extends IpcChannel>(channel: K, ...args: IpcCall<K>['args']) => ipcRenderer.invoke(channel, ...args) as IpcCall<K>['result'];

const api: LumiApi = {
  auth: {
    getState: () => invoke('auth:getState'),
    signIn: () => invoke('auth:signIn'),
    signOut: () => invoke('auth:signOut'),
  },
  data: {
    get: () => invoke('data:get'),
    refresh: () => invoke('data:refresh'),
    createEvent: (input) => invoke('data:createEvent', input),
    getRange: (fromIso, toIso) => invoke('data:getRange', fromIso, toIso),
  },
  agent: {
    send: (history) => invoke('agent:send', history),
    respondConfirm: (id, approved) => invoke('agent:respondConfirm', id, approved),
    ollamaStatus: () => invoke('agent:ollamaStatus'),
    setupOllama: () => invoke('agent:setupOllama'),
    setupState: () => invoke('agent:setupState'),
    startAi: () => invoke('agent:startAi'),
    stopAi: () => invoke('agent:stopAi'),
  },
  focus: {
    get: () => invoke('focus:get'),
    start: (minutes) => invoke('focus:start', minutes),
    stop: () => invoke('focus:stop'),
  },
  dnd: {
    get: () => invoke('dnd:get'),
    set: (untilMs) => invoke('dnd:set', untilMs),
  },
  weather: {
    get: () => invoke('weather:get'),
    refresh: () => invoke('weather:refresh'),
  },
  capture: {
    parse: (text) => invoke('capture:parse', text),
    close: () => invoke('capture:close'),
    setShortcut: (accelerator) => invoke('capture:setShortcut', accelerator),
  },
  updates: {
    getState: () => invoke('update:getState'),
    check: () => invoke('update:check'),
    download: () => invoke('update:download'),
    install: () => invoke('update:install'),
    openDownload: () => invoke('update:openDownload'),
  },
  music: {
    requestStart: () => invoke('music:requestStart'),
  },
  briefing: {
    show: () => invoke('briefing:show'),
  },
  mail: {
    draftReply: (emailId, instructions) => invoke('mail:draftReply', emailId, instructions),
    saveDraft: (draft) => invoke('mail:saveDraft', draft),
    suggestEvent: (emailId) => invoke('mail:suggestEvent', emailId),
  },
  voice: {
    transcribe: (samples) => invoke('voice:transcribe', samples),
  },
  docs: {
    pickFile: () => invoke('docs:pickFile'),
    answerFile: (path) => invoke('docs:answerFile', path),
  },
  routines: {
    list: () => invoke('routines:list'),
    save: (input) => invoke('routines:save', input),
    remove: (id) => invoke('routines:remove', id),
    run: (id) => invoke('routines:run', id),
  },
  news: {
    list: () => invoke('news:list'),
    open: (id) => invoke('news:open', id),
    markRead: (id) => invoke('news:markRead', id),
    dismiss: (id) => invoke('news:dismiss', id),
    clearRead: () => invoke('news:clearRead'),
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
  },
  window: {
    setMode: (mode) => invoke('window:setMode', mode),
    hide: () => invoke('window:hide'),
    openExternal: (url) => invoke('window:openExternal', url),
  },
  on(channel, listener) {
    if (!EVENTS.has(channel)) throw new Error(`Unknown channel ${channel}`);
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(channel, handler);
    return () => { ipcRenderer.removeListener(channel, handler); };
  },
};

contextBridge.exposeInMainWorld('lumi', api);
