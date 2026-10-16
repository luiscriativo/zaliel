// Implementação da Platform do editor usando a ponte do preload.
import type { Platform, UpdateStatus } from '@zaliel/editor';
import type { ZalielApi } from '../preload';

declare global {
  interface Window {
    zaliel: ZalielApi;
  }
}

export async function createPlatform(): Promise<Platform> {
  const z = window.zaliel;
  const info = await z.info();
  return {
    version: info.version,
    os: info.os,
    user: info.user ?? '',
    openDialog: z.openDialog,
    readFile: z.readFile,
    saveFile: z.saveFile,
    exportFile: z.exportFile,
    pickLibrary: z.pickLibrary,
    pickImages: z.pickImages,
    importDesign: z.importDesign,
    exportBatch: z.exportBatch,
    askUnsaved: z.askUnsaved,
    recent: z.recent,
    addRecent: z.addRecent,
    removeRecent: z.removeRecent,
    revealFile: z.revealFile,
    setWindowState: z.setWindowState,
    newWindow: z.newWindow,
    getSettings: z.getSettings,
    setSettings: z.setSettings,
    writeRecovery: z.writeRecovery,
    listRecovery: z.listRecovery,
    readRecovery: z.readRecovery,
    clearRecovery: z.clearRecovery,
    on: ((event: string, cb: (arg: never) => void) => z.on(event, cb as (...a: unknown[]) => void)) as Platform['on'],
    confirmClose: z.confirmClose,
    automation: {
      info: z.automation.info,
      regenerate: z.automation.regenerate,
      serve: z.automation.serve,
      readBinary: z.automation.readBinary,
      writeFile: z.automation.writeFile,
    },
    update: {
      status: z.update.status as () => Promise<UpdateStatus>,
      check: z.update.check as () => Promise<UpdateStatus>,
      download: z.update.download as () => Promise<UpdateStatus>,
      install: z.update.install as () => Promise<{ ok: boolean }>,
    },
  };
}
