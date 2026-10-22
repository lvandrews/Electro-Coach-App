import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { spBall, spEnd, type StraightPoolMatch } from '../src/engine/games';
import { opponents, scoresheetPdf, scoresheetText, sheetSummary } from '../src/engine/scoresheet';

const m0 = (id: string, them: string, date: string, venue?: string): StraightPoolMatch =>
  ({ id, kind: 'straight-pool', date, updated: date, players: ['Lela', them], raceTo: 25, first: 0, innings: [], device: '', venue });
const balls = (m: StraightPoolMatch, n: number) => { for (let i = 0; i < n; i++) m = spBall(m); return m; };

function match(id: string, them: string, date: string, iWin: boolean, venue?: string) {
  let m = spEnd(balls(m0(id, them, date, venue), 7), 'miss');
  m = spEnd(balls(m, 4), 'foul');
  m = iWin ? balls(m, 18) : spEnd(balls(m, 2), 'miss');
  if (!iWin) m = balls(m, 25);
  return { ...m, ended: date };
}

describe('straight pool scoresheet and opponents', () => {
  const a = match('a', 'Sam Lee', '2026-10-01T19:00:00Z', true, 'Hall A');
  const b = match('b', 'sam lee ', '2026-10-08T19:00:00Z', false);
  const c = match('c', 'Jo', '2026-10-09T19:00:00Z', true);
  it('summarizes a match inning by inning with the score after each', () => {
    const x = sheetSummary(a);
    expect(x.winner).toBe(0);
    expect(x.rows.map(r => r.score)).toEqual([[7, 0], [7, 3], [25, 3]]);
    expect(x.fouls).toEqual([0, 1]); expect(x.penalty).toEqual([0, 1]);
    const t = scoresheetText(a);
    expect(t).toContain('Lela wins 25–3'); expect(t).toContain('Hall A');
  });
  it('groups opponents by name regardless of case and spacing', () => {
    const o = opponents([a, b, c]);
    expect(o.map(x => x.name)).toEqual(['Jo', 'sam lee']);
    const sam = o.find(x => x.key === 'sam lee')!;
    expect([sam.wins, sam.losses]).toEqual([1, 1]);
    expect(sam.venues).toEqual(['Hall A']);
  });
  it('writes a well-formed PDF', () => {
    const pdf = scoresheetPdf(a);
    const s = new TextDecoder('latin1').decode(pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xref, xref + 4)).toBe('xref');
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, pdf);
  });
});

import { playedText } from '../src/engine/games';
describe('table details', () => {
  it('summarizes venue and table', () => {
    expect(playedText({ venue: 'Family Billiards', table: { brand: 'Brunswick', model: 'Gold Crown VII', size: '9ft', pocketIn: 4.5 } }))
      .toBe('Family Billiards · Brunswick Gold Crown VII · 9 ft · 4½″ pockets');
    expect(playedText({ table: { pocketIn: 4.125 } }, { ascii: true })).toBe('4.125 in pockets');
    expect(playedText({})).toBe('');
  });
});
