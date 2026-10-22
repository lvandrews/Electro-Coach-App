import { bpi, playedText, spState, type InningEnd, type StraightPoolMatch } from './games';
import { buildPdf, PAGE, type PdfItem } from './pdf';

// A straight pool scoresheet to share: plain text (email, messages) or a PDF.

export const END_LABEL: Record<InningEnd, string> = { open: 'in progress', miss: 'miss', safety: 'safety', foul: 'foul', breakFoul: 'break foul', win: 'won' };

export interface SheetRow { n: number; p: 0 | 1; balls: number; end: InningEnd; score: [number, number] }
export interface SheetSummary {
  date: string; venue?: string; where: string; whereAscii: string; players: [string, string]; raceTo: number; first: 0 | 1;
  score: [number, number]; winner: 0 | 1 | null; finished: boolean;
  innings: [number, number]; balls: [number, number]; bpi: [number | null, number | null]; highRun: [number, number];
  fouls: [number, number]; penalty: [number, number]; rows: SheetRow[]; note?: string;
}

export function sheetSummary(m: StraightPoolMatch): SheetSummary {
  const s = spState(m);
  const rows: SheetRow[] = [];
  const fouls: [number, number] = [0, 0];
  m.innings.forEach((inn, i) => {
    if (inn.end === 'open' && inn.balls === 0) return;
    const after = spState({ ...m, innings: m.innings.slice(0, i + 1) });
    rows.push({ n: rows.length + 1, p: inn.p, balls: inn.balls, end: inn.end, score: after.score });
    if (inn.end === 'foul' || inn.end === 'breakFoul') fouls[inn.p]++;
  });
  return {
    date: m.date, venue: m.venue, where: playedText(m), whereAscii: playedText(m, { ascii: true }), players: m.players, raceTo: m.raceTo, first: m.first,
    score: s.score, winner: s.winner, finished: !!m.ended || s.winner != null,
    innings: s.innings, balls: s.balls, bpi: [bpi(s, 0), bpi(s, 1)], highRun: s.highRun,
    fouls, penalty: [s.balls[0] - s.score[0], s.balls[1] - s.score[1]], rows, note: m.note,
  };
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const f2 = (x: number | null) => (x == null ? '—' : x.toFixed(2));

function headline(x: SheetSummary) {
  const [a, b] = x.players;
  if (x.winner != null) return `${x.players[x.winner]} wins ${x.score[x.winner]}–${x.score[1 - x.winner]}`;
  return `${a} ${x.score[0]}, ${b} ${x.score[1]} (${x.finished ? 'ended early' : 'in progress'})`;
}

export function scoresheetText(m: StraightPoolMatch): string {
  const x = sheetSummary(m);
  const [a, b] = x.players;
  const L: string[] = [];
  L.push(`Straight pool (14.1 continuous): ${a} vs ${b}`);
  L.push(`${day(x.date)} · race to ${x.raceTo} · ${x.players[x.first]} broke`);
  if (x.where) L.push(x.where);
  L.push('', headline(x), '');
  for (const p of [0, 1] as const) {
    L.push(`${x.players[p]}: ${x.score[p]} points · ${x.balls[p]} balls in ${x.innings[p]} innings · ${f2(x.bpi[p])} balls per inning · high run ${x.highRun[p]} · ${x.fouls[p]} foul${x.fouls[p] === 1 ? '' : 's'}${x.penalty[p] ? ` (−${x.penalty[p]})` : ''}`);
  }
  if (x.note) L.push('', `Note: ${x.note}`);
  L.push('', 'Inning by inning (score after each):');
  for (const r of x.rows) L.push(`${String(r.n).padStart(3)}. ${x.players[r.p]}: ${r.balls} ${r.balls === 1 ? 'ball' : 'balls'}, ${END_LABEL[r.end]} · ${r.score[0]}–${r.score[1]}`);
  L.push('', 'Scored with Electro-Coach.');
  return L.join('\n');
}

export function scoresheetPdf(m: StraightPoolMatch): Uint8Array {
  const x = sheetSummary(m);
  const M = PAGE.margin, W = PAGE.w - 2 * M;
  const pages: PdfItem[][] = [];
  let page: PdfItem[] = [];
  let y = M;
  const t = (text: string, xx: number, size = 10, o: Partial<{ bold: boolean; align: 'left' | 'right' | 'center'; gray: boolean }> = {}) => page.push({ kind: 'text', x: xx, y, text, size, ...o });
  const rule = (gray = true, w = 0.5) => page.push({ kind: 'line', x1: M, y1: y, x2: M + W, y2: y, gray, width: w });

  t('Straight pool (14.1 continuous)', M, 9, { gray: true }); y += 22;
  t(`${x.players[0]} vs ${x.players[1]}`, M, 20, { bold: true }); y += 18;
  t(`${day(x.date)} · race to ${x.raceTo} · ${x.players[x.first]} broke`, M, 10, { gray: true }); y += 14;
  if (x.whereAscii) { t(x.whereAscii, M, 10, { gray: true }); y += 14; }
  y += 12;
  t(headline(x), M, 14, { bold: true }); y += 20;
  rule(false, 1); y += 16;

  // summary table
  const cols = [M, M + 190, M + 250, M + 305, M + 360, M + 425, M + 480];
  const head = ['Player', 'Points', 'Balls', 'Innings', 'Per inning', 'High run', 'Fouls'];
  head.forEach((h, i) => t(h, i ? cols[i] + 40 : cols[i], 9, { bold: true, align: i ? 'right' : 'left' }));
  y += 6; rule(); y += 14;
  for (const p of [0, 1] as const) {
    const v = [x.players[p], String(x.score[p]), String(x.balls[p]), String(x.innings[p]), f2(x.bpi[p]), String(x.highRun[p]), `${x.fouls[p]}${x.penalty[p] ? ` (−${x.penalty[p]})` : ''}`];
    v.forEach((s, i) => t(s, i ? cols[i] + 40 : cols[i], 10, { align: i ? 'right' : 'left', bold: i === 1 && x.winner === p }));
    y += 16;
  }
  if (x.note) { y += 6; t(`Note: ${x.note}`, M, 10); y += 16; }
  y += 14;
  t('Inning by inning', M, 11, { bold: true }); y += 6; rule(false, 0.75); y += 14;

  // two columns of innings, score after each
  const colW = W / 2, perCol = (top: number) => Math.floor((PAGE.h - M - 20 - top) / 14);
  const header = (cx: number) => {
    t('#', cx + 18, 8, { gray: true, align: 'right' }); t('Player', cx + 26, 8, { gray: true });
    t('Run', cx + 150, 8, { gray: true, align: 'right' }); t('Ended', cx + 160, 8, { gray: true }); t('Score', colW + cx - 12, 8, { gray: true, align: 'right' });
  };
  let i = 0;
  while (i < x.rows.length) {
    const top = y, n = perCol(top + 14);
    for (let c = 0; c < 2 && i < x.rows.length; c++) {
      const cx = M + c * colW;
      y = top; header(cx); y += 14;
      for (let k = 0; k < n && i < x.rows.length; k++, i++) {
        const r = x.rows[i];
        t(String(r.n), cx + 18, 9, { align: 'right', gray: true });
        t(x.players[r.p].slice(0, 22), cx + 26, 9);
        t(String(r.balls), cx + 150, 9, { align: 'right', bold: r.balls >= 10 });
        t(END_LABEL[r.end], cx + 160, 9, { gray: r.end === 'miss' || r.end === 'safety' });
        t(`${r.score[0]}–${r.score[1]}`, colW + cx - 12, 9, { align: 'right' });
        y += 14;
      }
    }
    if (i < x.rows.length) { pages.push(page); page = []; y = M; }
  }
  y = PAGE.h - M + 10;
  t('Scored with Electro-Coach', M, 8, { gray: true });
  t(`Page ${pages.length + 1}`, M + W, 8, { gray: true, align: 'right' });
  pages.push(page);
  return buildPdf(pages, `Straight pool: ${x.players[0]} vs ${x.players[1]}`);
}

// ---------- opponents ----------

export interface OpponentRecord {
  key: string; name: string; matches: StraightPoolMatch[]; wins: number; losses: number; unfinished: number;
  bpi: [number | null, number | null]; highRun: [number, number]; last: string; venues: string[];
}

export const opponentKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export function opponents(matches: StraightPoolMatch[]): OpponentRecord[] {
  const by = new Map<string, StraightPoolMatch[]>();
  for (const m of matches) { const k = opponentKey(m.players[1]); if (!k) continue; (by.get(k) ?? by.set(k, []).get(k)!).push(m); }
  const out: OpponentRecord[] = [];
  for (const [key, ms] of by) {
    ms.sort((a, b) => (a.date < b.date ? -1 : 1));
    let wins = 0, losses = 0, unfinished = 0;
    const balls: [number, number] = [0, 0], inn: [number, number] = [0, 0], high: [number, number] = [0, 0];
    for (const m of ms) {
      const s = spState(m);
      if (s.winner === 0) wins++; else if (s.winner === 1) losses++; else unfinished++;
      for (const p of [0, 1] as const) { balls[p] += s.balls[p]; inn[p] += s.innings[p]; high[p] = Math.max(high[p], s.highRun[p]); }
    }
    out.push({
      key, name: ms[ms.length - 1].players[1].trim(), matches: ms, wins, losses, unfinished,
      bpi: [inn[0] ? balls[0] / inn[0] : null, inn[1] ? balls[1] / inn[1] : null], highRun: high, last: ms[ms.length - 1].date,
      venues: [...new Set(ms.map(m => m.venue?.trim()).filter((v): v is string => !!v))],
    });
  }
  return out.sort((a, b) => (a.last < b.last ? 1 : -1));
}

export const knownVenues = (matches: StraightPoolMatch[]) =>
  [...new Set([...matches].sort((a, b) => (a.date < b.date ? 1 : -1)).map(m => m.venue?.trim()).filter((v): v is string => !!v))];
