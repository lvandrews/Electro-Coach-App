import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';
import { isNative } from './platform';

// End-of-block alerts for timed practice. On Android they are scheduled with the
// system, so they arrive on time even while Railbird is filming in front, and a
// paired watch (Garmin, Wear OS) mirrors them. In a desktop browser they are not
// needed: the session screen plays its own tones.

const CHANNEL = 'practice-blocks';
let prepared: Promise<{ ok: boolean; exact: boolean }> | null = null;

/** Ask for permission once and create a high-importance channel (sound + vibration). */
export function prepareNotifications() {
  prepared ??= (async () => {
    if (!isNative()) return { ok: false, exact: false };
    try {
      let p = await LocalNotifications.checkPermissions();
      if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
      await LocalNotifications.createChannel({ id: CHANNEL, name: 'Practice blocks', description: 'The end of a timed practice block', importance: 5, vibration: true, visibility: 1 });
      let exact = true;
      try { exact = (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted'; } catch { /* older Android: always exact */ }
      return { ok: p.display === 'granted', exact };
    } catch { return { ok: false, exact: false }; }
  })();
  return prepared;
}

/** Opens Android's "Alarms & reminders" setting for this app (so alerts are exact to the second). */
export async function askExactAlarms() {
  try { await LocalNotifications.changeExactNotificationSetting(); prepared = null; } catch { /* not available */ }
}

export async function scheduleBlockEnd(id: number, at: Date, title: string, body: string) {
  if (!isNative()) return;
  const { ok } = await prepareNotifications();
  if (!ok) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id }] });
    await LocalNotifications.schedule({ notifications: [{ id, title, body, channelId: CHANNEL, schedule: { at, allowWhileIdle: true } }] });
  } catch { /* the in-app alert still works */ }
}

export async function cancelBlockEnd(id: number) {
  if (!isNative()) return;
  try { await LocalNotifications.cancel({ notifications: [{ id }] }); } catch { /* nothing scheduled */ }
}

/** Share plain text (Android share sheet, or the browser's share / clipboard). Returns how it went. */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (isNative()) { await Share.share({ title, text, dialogTitle: title }); return 'shared'; }
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
    if (nav.share) { await nav.share({ title, text }); return 'shared'; }
    await navigator.clipboard.writeText(text); return 'copied';
  } catch {
    try { await navigator.clipboard.writeText(text); return 'copied'; } catch { return 'failed'; }
  }
}

// ---------- practice reminders ----------

const REMINDER_CHANNEL = 'reminders';
let reminderChannel: Promise<boolean> | null = null;

/** Replace the scheduled reminders with these (all three ids are cleared first). */
export async function scheduleReminders(ids: number[], notes: { id: number; at: Date; title: string; body: string }[]) {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) });
    if (!notes.length) return;
    const { ok } = await prepareNotifications();
    if (!ok) return;
    // A quieter channel than the end-of-block alerts: default importance, no vibration.
    reminderChannel ??= LocalNotifications.createChannel({ id: REMINDER_CHANNEL, name: 'Practice reminders', description: 'Reminders to log practice and a recap of your last session', importance: 3, vibration: false, visibility: 1 })
      .then(() => true).catch(() => false);
    await reminderChannel;
    await LocalNotifications.schedule({ notifications: notes.map(n => ({ id: n.id, title: n.title, body: n.body, channelId: REMINDER_CHANNEL, schedule: { at: n.at, allowWhileIdle: true } })) });
  } catch { /* reminders are best-effort */ }
}
