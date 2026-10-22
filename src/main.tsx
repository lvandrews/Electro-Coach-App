import { render } from 'preact';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import './styles.css';
import { App } from './app';
import { applyPrefs } from './ui/prefs';
import { isNative } from './platform';

// Ask the browser to keep this app's data even under storage pressure.
try { navigator.storage?.persist?.().catch(() => {}); } catch { /* not supported */ }

// The hosted web version works offline once loaded (not in the Android app or a local file).
if ('serviceWorker' in navigator && location.protocol === 'https:' && !isNative()) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

applyPrefs();
render(<App />, document.getElementById('app')!);
