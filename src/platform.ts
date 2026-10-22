import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNative = () => Capacitor.isNativePlatform();

/**
 * Save a text file. On Android it is written to the app's cache and handed to the
 * share sheet (Drive, Files, email…); in a desktop browser it downloads.
 */
export async function saveTextFile(name: string, text: string, mime = 'application/json') {
  if (isNative()) {
    const res = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, url: res.uri, dialogTitle: 'Save backup' });
    return;
  }
  // iPhone and other touch browsers: the share sheet (Files, Drive, email) where it takes files.
  const file = new File([text], name, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (matchMedia('(pointer: coarse)').matches && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name } as ShareData); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Share a file (a PDF, say) through the share sheet; in a browser without file sharing it downloads. */
export async function shareFile(name: string, bytes: Uint8Array, mime: string, title: string) {
  if (isNative()) {
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const res = await Filesystem.writeFile({ path: name, data: btoa(bin), directory: Directory.Cache });
    await Share.share({ title, files: [res.uri], dialogTitle: title });
    return;
  }
  const file = new File([bytes as BlobPart], name, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title } as ShareData); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}

/** Open a web page outside the app: the phone's browser on Android, a new tab elsewhere. */
export function openExternal(url: string) {
  // In the Android app, navigating to another site hands it to the system browser.
  if (isNative()) { window.location.href = url; return; }
  window.open(url, '_blank', 'noopener');
}

/**
 * GET JSON from another site. The Android app uses native HTTP (no browser CORS
 * limits). In a browser, a direct request is tried first, then the same-origin
 * proxy path the hosted web version provides (see netlify.toml).
 */
export async function getJson(url: string, proxyPath?: string): Promise<unknown> {
  if (isNative()) {
    const r = await CapacitorHttp.get({ url, headers: { Accept: 'application/json' } });
    if (r.status < 200 || r.status >= 300) throw new Error(`the site answered ${r.status}`);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`the site answered ${r.status}`);
    return await r.json();
  } catch (e) {
    if (!proxyPath || !/^https?:$/.test(location.protocol)) throw e;
    const r = await fetch(proxyPath, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`the site answered ${r.status}`);
    return await r.json();
  }
}
