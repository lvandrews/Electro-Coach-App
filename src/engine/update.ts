// Update check for the Android app: compare this build's version with the latest GitHub
// release. Releases are tagged v0.1.N and carry one APK, electro-coach-0.1.N.apk.

export interface ReleaseInfo {
  version: string;        // "0.1.21"
  apkUrl: string | null;  // direct download of the APK
  pageUrl: string;        // the release page on GitHub
  published: string | null;
  notes: string;          // "What's new" from the release notes (the commit description), or ''
}

/** "v0.1.21", "0.1.21" → [0, 1, 21]; anything else → null. */
export function parseVersion(v: string | null | undefined): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec((v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is a later version than `current`; false when either can't be read. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Read GitHub's "latest release" answer. Null when it isn't a usable release. */
export function readRelease(json: unknown): ReleaseInfo | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as { tag_name?: unknown; html_url?: unknown; published_at?: unknown; body?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  if (r.draft || r.prerelease || typeof r.tag_name !== 'string' || !parseVersion(r.tag_name)) return null;
  const assets = Array.isArray(r.assets) ? r.assets as { name?: unknown; browser_download_url?: unknown }[] : [];
  const apk = assets.find(a => typeof a.name === 'string' && /\.apk$/i.test(a.name) && typeof a.browser_download_url === 'string');
  const safe = (u: unknown) => (typeof u === 'string' && u.startsWith('https://github.com/') ? u : null);
  return {
    version: r.tag_name.replace(/^v/, ''),
    apkUrl: safe(apk?.browser_download_url),
    pageUrl: safe(r.html_url) ?? '',
    published: typeof r.published_at === 'string' ? r.published_at : null,
    notes: typeof r.body === 'string' ? whatsNew(r.body) : '',
  };
}

/** The part of a release's notes under "What's new" (the build copies in the commit message). */
export function whatsNew(body: string): string {
  const m = /^#+\s*What's new\s*$/im.exec(body);
  if (!m) return '';
  const text = body.slice(m.index + m[0].length).replace(/\r/g, '').trim();
  return text.length > 2000 ? `${text.slice(0, 2000).trimEnd()}…` : text;
}

/** Check at most every 12 hours (the Check button in About always checks). */
export const CHECK_EVERY_MS = 12 * 3600_000;
/** "Not now" quiets the prompt for a day. */
export const SNOOZE_MS = 24 * 3600_000;

export interface UpdateMemory { lastCheck?: number; latest?: ReleaseInfo | null; snoozedUntil?: number; skipped?: string }

/** Whether to show the prompt for a release we know about. */
export function shouldPrompt(rel: ReleaseInfo | null, current: string, mem: UpdateMemory, now: number): boolean {
  if (!rel || !isNewer(rel.version, current)) return false;
  if (mem.skipped === rel.version) return false;
  if (mem.snoozedUntil && now < mem.snoozedUntil) return false;
  return true;
}
