// Runs in a sandboxed preload: only `electron` may be required here, so channel
// names are inlined and shared types are imported as types only.
import { contextBridge, ipcRenderer } from 'electron';
import type { LumiApi } from '../shared/types';

const EVENTS = new Set(['reminder', 'data:updated', 'agent:confirm', 'agent:status', 'auth:changed', 'settings:changed', 'focus:changed', 'briefing', 'activity']);

const api: LumiApi = {
  auth: {
    getState: () => ipcRenderer.invoke('auth:getState'),
    signIn: () => ipcRenderer.invoke('auth:signIn'),
    signOut: () => ipcRenderer.invoke('auth:signOut'),
  },
  data: {
    get: () => ipcRenderer.invoke('data:get'),
    refresh: () => ipcRenderer.invoke('data:refresh'),
    createEvent: (input) => ipcRenderer.invoke('data:createEvent', input),
    getRange: (fromIso, toIso) => ipcRenderer.invoke('data:getRange', fromIso, toIso),
  },
  agent: {
    send: (history) => ipcRenderer.invoke('agent:send', history),
    respondConfirm: (id, approved) => ipcRenderer.invoke('agent:respondConfirm', id, approved),
    ollamaStatus: () => ipcRenderer.invoke('agent:ollamaStatus'),
  },
  focus: {
    get: () => ipcRenderer.invoke('focus:get'),
    start: (minutes) => ipcRenderer.invoke('focus:start', minutes),
    stop: () => ipcRenderer.invoke('focus:stop'),
  },
  music: {
    requestStart: () => ipcRenderer.invoke('music:requestStart'),
  },
  briefing: {
    show: () => ipcRenderer.invoke('briefing:show'),
  },
  mail: {
    draftReply: (emailId, instructions) => ipcRenderer.invoke('mail:draftReply', emailId, instructions),
    saveDraft: (draft) => ipcRenderer.invoke('mail:saveDraft', draft),
    suggestEvent: (emailId) => ipcRenderer.invoke('mail:suggestEvent', emailId),
  },
  voice: {
    transcribe: (samples) => ipcRenderer.invoke('voice:transcribe', samples),
  },
  docs: {
    pickFile: () => ipcRenderer.invoke('docs:pickFile'),
    answerFile: (path) => ipcRenderer.invoke('docs:answerFile', path),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
  },
  window: {
    setMode: (mode) => ipcRenderer.invoke('window:setMode', mode),
    hide: () => ipcRenderer.invoke('window:hide'),
    openExternal: (url) => ipcRenderer.invoke('window:openExternal', url),
  },
  on(channel, listener) {
    if (!EVENTS.has(channel)) throw new Error(`Unknown channel ${channel}`);
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => { ipcRenderer.removeListener(channel, handler); };
  },
};

contextBridge.exposeInMainWorld('lumi', api);
