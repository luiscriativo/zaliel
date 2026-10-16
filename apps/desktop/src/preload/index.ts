// Ponte segura entre a interface e o sistema (contextIsolation).
import { contextBridge, ipcRenderer, webUtils } from 'electron';

const on = (channel: string, cb: (...args: unknown[]) => void) => {
  const fn = (_e: unknown, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

const api = {
  info: () => ipcRenderer.invoke('app:info'),
  pendingOpen: () => ipcRenderer.invoke('app:pending-open'),
  openDialog: () => ipcRenderer.invoke('file:open-dialog'),
  pickLibrary: () => ipcRenderer.invoke('file:pick-library'),
  readFile: (p: string) => ipcRenderer.invoke('file:read', p),
  saveFile: (path: string | null, text: string, suggestedName: string) => ipcRenderer.invoke('file:save', { path, text, suggestedName }),
  exportFile: (data: Uint8Array | string, name: string, kind: string) => ipcRenderer.invoke('file:export', { data, name, kind }),
  pickImages: () => ipcRenderer.invoke('file:pick-images'),
  importDesign: (file?: string) => ipcRenderer.invoke('file:import', file),
  exportBatch: (files: unknown) => ipcRenderer.invoke('file:export-batch', files),
  askUnsaved: (name: string) => ipcRenderer.invoke('dialog:unsaved', name),
  revealFile: (p: string) => ipcRenderer.invoke('file:reveal', p),
  recent: () => ipcRenderer.invoke('recent:list'),
  addRecent: (p: string, name: string) => ipcRenderer.invoke('recent:add', p, name),
  removeRecent: (p: string) => ipcRenderer.invoke('recent:remove', p),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  writeRecovery: (entry: unknown, text: string) => ipcRenderer.invoke('recovery:write', entry, text),
  listRecovery: () => ipcRenderer.invoke('recovery:list'),
  readRecovery: (id: string) => ipcRenderer.invoke('recovery:read', id),
  clearRecovery: (id: string) => ipcRenderer.invoke('recovery:clear', id),
  setWindowState: (s: unknown) => ipcRenderer.send('window:state', s),
  newWindow: () => ipcRenderer.send('window:new'),
  confirmClose: () => ipcRenderer.send('window:confirm-close'),
  automation: {
    info: () => ipcRenderer.invoke('automation:info'),
    regenerate: () => ipcRenderer.invoke('automation:regenerate'),
    readBinary: (p: string) => ipcRenderer.invoke('automation:read-binary', p),
    writeFile: (p: string, data: string, base64: boolean) => ipcRenderer.invoke('automation:write-file', p, data, base64),
    /** O editor está pronto: passa a receber pedidos. `handler` devolve o resultado (ou lança erro). */
    serve: (handler: (payload: unknown) => Promise<unknown>) => {
      ipcRenderer.removeAllListeners('automation:request');
      ipcRenderer.on('automation:request', async (_e, msg: { id: number; payload: unknown }) => {
        try {
          ipcRenderer.send('automation:response', { id: msg.id, result: await handler(msg.payload) });
        } catch (err) {
          ipcRenderer.send('automation:response', { id: msg.id, error: String((err as Error)?.message ?? err) });
        }
      });
      ipcRenderer.send('automation:ready');
    },
  },
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
  },
  on,
  pathForFile: (f: File) => webUtils.getPathForFile(f),
};

contextBridge.exposeInMainWorld('zaliel', api);

export type ZalielApi = typeof api;
