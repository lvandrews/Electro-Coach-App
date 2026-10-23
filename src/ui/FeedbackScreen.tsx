import { useEffect, useRef, useState } from 'preact/hooks';
import { openExternal } from '../platform';
import { APP_VERSION, REPO_URL } from '../version';
import { platformName, track } from '../usage';

const POOLBILLIARDS = 'https://www.poolbilliards.co/';
const footer = () => `\n\n---\nElectro-Coach ${APP_VERSION} · ${platformName()}`;
const issue = (title: string, body: string) => `${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

/** A new GitHub issue with the app version filled in; nothing else about the person is added. */
export function feedbackUrl(kind: 'problem' | 'idea'): string {
  return kind === 'problem'
    ? issue('Problem: ', `**What happened?**\n\n\n**What did you expect?**\n\n\n**Steps to get there (if you know them)**\n${footer()}`)
    : issue('Idea: ', `**What would help?**\n\n\n**How would you use it?**\n${footer()}`);
}

/** A drill request: a poolbilliards.co link (or any description), as a GitHub issue. */
export function drillRequestUrl(link: string, notes: string): string {
  const l = link.trim(), n = notes.trim();
  let name = '';
  try {
    const u = new URL(l);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    name = decodeURIComponent(last).replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').trim();
  } catch { name = l.slice(0, 60); }
  const title = `Drill request: ${name || n.slice(0, 60) || 'new drill'}`;
  const body = `**The drill**\n${l || '(no link)'}\n\n**Notes** (how you'd use it, variations, how you'd score it)\n${n || ''}${footer()}`;
  return issue(title, body);
}

export const isPoolBilliardsLink = (s: string) => /(^|\/\/|\.)poolbilliards\.co(\/|$)/i.test(s.trim());

export function FeedbackScreen({ focus }: { focus?: string | null }) {
  const [link, setLink] = useState('');
  const [notes, setNotes] = useState('');
  const drillCard = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus === 'drill') drillCard.current?.scrollIntoView({ block: 'start' }); }, [focus]);
  const hasLink = link.trim().length > 0;
  const offSite = hasLink && !isPoolBilliardsLink(link);

  return (
    <section>
      <h2>Feedback</h2>
      <p class="lede">Your feedback is wanted, and it makes a real difference. Electro-Coach is built by one player, and what
        players send decides what gets fixed and added next. Problems, ideas, a drill you’d like, something that confused you:
        all of it helps, and every report is read.</p>

      <div class="card" ref={drillCard}>
        <h3>Request a drill</h3>
        <p class="small" style={{ marginTop: 0 }}>Find the drill on <button class="link-btn" onClick={() => openExternal(POOLBILLIARDS)}>poolbilliards.co</button>,
          copy the link to it and paste it here. That’s all it takes to get a drill considered for the app: diagram, tag, tallies and all.
          Not on poolbilliards.co? Paste another link or describe it in the notes: the layout, what you shoot and how you’d score it.</p>
        <div class="note-form">
          <label class="grow">Link to the drill<input type="url" inputMode="url" placeholder="https://www.poolbilliards.co/…" value={link} onInput={e => setLink((e.target as HTMLInputElement).value)} /></label>
        </div>
        <label class="small muted" style={{ display: 'grid', gap: '3px', marginTop: '8px' }}>Notes (optional)
          <textarea rows={3} value={notes} placeholder="Why you like it, a variation, how you'd score it…" onInput={e => setNotes((e.target as HTMLTextAreaElement).value)} /></label>
        {offSite && <p class="small muted" style={{ margin: '6px 0 0' }}>That isn’t a poolbilliards.co link. That’s fine; a few words in the notes about the layout will help.</p>}
        <div class="row" style={{ gap: '8px', marginTop: '10px' }}>
          <button class="btn primary" disabled={!hasLink && !notes.trim()} onClick={() => { track('feedback_sent', { kind: 'drill' }); openExternal(drillRequestUrl(link, notes)); }}>Send drill request</button>
          <button class="btn" onClick={() => openExternal(POOLBILLIARDS)}>Open poolbilliards.co</button>
        </div>
      </div>

      <div class="card">
        <h3>A problem or an idea</h3>
        <p class="small" style={{ marginTop: 0 }}>Something broken, confusing or missing; a feature you’d use; a drill or screen that could work better.</p>
        <div class="row" style={{ gap: '8px' }}>
          <button class="btn primary" onClick={() => { track('feedback_sent', { kind: 'problem' }); openExternal(feedbackUrl('problem')); }}>Report a problem</button>
          <button class="btn" onClick={() => { track('feedback_sent', { kind: 'idea' }); openExternal(feedbackUrl('idea')); }}>Suggest an idea</button>
          <button class="btn" onClick={() => openExternal(`${REPO_URL}/issues`)}>See what others sent</button>
        </div>
      </div>

      <div class="card">
        <h3>How it’s sent</h3>
        <p class="small" style={{ margin: 0 }}>Each button opens a new issue on the project’s GitHub page with the app version filled in. You need a free
          GitHub account, and what you write there is public, so leave out anything private. Nothing is sent until you press Submit on GitHub.</p>
      </div>
    </section>
  );
}
