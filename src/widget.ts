import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNative } from './platform';
import { applyRoutineEdits, ROUTINE, type RoutineEdits } from './engine/routine';

// The home-screen routine widget (Android): RoutineWidgetPlugin.java stores the text and
// size where the widget reads them; tapping the widget opens the app on the routine page.

interface WidgetRow { k: 'h' | 'q' | 'p'; t: string }
interface RoutineWidgetPlugin {
  update(o: { items: WidgetRow[]; scale: number }): Promise<void>;
  takeOpen(): Promise<{ open?: string }>;
  addListener(event: 'open', fn: (o: { open?: string }) => void): Promise<PluginListenerHandle>;
}
const Widget = registerPlugin<RoutineWidgetPlugin>('RoutineWidget');

export type WidgetSize = 'normal' | 'large' | 'xlarge';
export const WIDGET_SCALE: Record<WidgetSize, number> = { normal: 1, large: 1.25, xlarge: 1.5 };
const K = 'ec-widget-size';
export function getWidgetSize(): WidgetSize { try { const v = localStorage.getItem(K); return v === 'large' || v === 'xlarge' ? v : 'normal'; } catch { return 'normal'; } }

/** The widget's rows: the quick card first, then every section of notes. */
export function widgetRows(edits: RoutineEdits | null): WidgetRow[] {
  const r = applyRoutineEdits(ROUTINE, edits);
  return [
    { k: 'h', t: 'Quick card' },
    ...r.quick.map((s, i) => ({ k: 'q' as const, t: `${i + 1}. ${s.title}: ${s.cue}` })),
    ...r.sections.flatMap(s => [{ k: 'h' as const, t: s.title }, ...s.points.map(p => ({ k: 'p' as const, t: `• ${p}` }))]),
  ];
}

/** Send the current routine to the widget (Android only; quietly does nothing elsewhere). */
export async function syncWidget(edits: RoutineEdits | null, size: WidgetSize = getWidgetSize()) {
  if (!isNative()) return;
  try { await Widget.update({ items: widgetRows(edits), scale: WIDGET_SCALE[size] }); } catch { /* older app shell: no widget */ }
}

export function setWidgetSize(size: WidgetSize, edits: RoutineEdits | null) {
  try { localStorage.setItem(K, size); } catch { /* ignore */ }
  void syncWidget(edits, size);
}

/** Calls `onOpen(page)` when the widget opened the app. Returns a cleanup function. */
export function listenForWidgetOpen(onOpen: (page: string) => void): () => void {
  if (!isNative()) return () => {};
  let handle: PluginListenerHandle | null = null, live = true;
  Widget.addListener('open', o => { if (live && o.open) onOpen(o.open); }).then(h => { if (live) handle = h; else h.remove(); }).catch(() => {});
  Widget.takeOpen().then(o => { if (live && o.open) onOpen(o.open); }).catch(() => {});
  return () => { live = false; handle?.remove(); };
}
