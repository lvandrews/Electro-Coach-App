import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNative } from './platform';

// Railbird CSV exports shared to the Android app (Share → Electro-Coach, or Open with).
// The native side (IncomingFilePlugin.java) reads the file and hands over its text.

export interface IncomingFile { name?: string; text?: string; error?: string }
interface IncomingFilePlugin {
  takePending(): Promise<IncomingFile>;
  addListener(event: 'fileReceived', fn: (f: IncomingFile) => void): Promise<PluginListenerHandle>;
}
const Incoming = registerPlugin<IncomingFilePlugin>('IncomingFile');

/** Calls `onFile` for the file that opened the app and for any shared while it's open. Returns a cleanup function. */
export function listenForSharedFiles(onFile: (f: IncomingFile) => void): () => void {
  if (!isNative()) return () => {};
  let handle: PluginListenerHandle | null = null, live = true;
  Incoming.addListener('fileReceived', f => { if (live) onFile(f); }).then(h => { if (live) handle = h; else h.remove(); }).catch(() => {});
  Incoming.takePending().then(f => { if (live && (f.text || f.error)) onFile(f); }).catch(() => {});
  return () => { live = false; handle?.remove(); };
}
