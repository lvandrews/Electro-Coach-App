import { describe, expect, it } from 'vitest';
import { buildEvent, cleanProps, drillLabel, endpointFor, nextSession, shotBand } from '../src/engine/usage';

describe('usage counts', () => {
  it('sends only allowed properties', () => {
    expect(cleanProps('screen', { screen: 'drills', note: 'my secret' })).toEqual({ screen: 'drills' });
    expect(cleanProps('routine_edited', { text: 'anything' })).toBeUndefined();
    expect(cleanProps('screen', { screen: 'x'.repeat(100) })!.screen).toHaveLength(40);
    expect(cleanProps('session_started', { minutes: NaN })).toBeUndefined();
  });
  it('reports custom drills without their names', () => {
    const ids = new Set(['bowling-10']);
    expect(drillLabel('bowling-10', ids)).toBe('bowling-10');
    expect(drillLabel('c-abc123', ids)).toBe('custom');
  });
  it('bands shot counts', () => {
    expect(shotBand(12)).toBe('under 100');
    expect(shotBand(450)).toBe('100-499');
    expect(shotBand(1999)).toBe('500-1999');
    expect(shotBand(25000)).toBe('2000+');
  });
  it('picks the region from the app key', () => {
    expect(endpointFor('A-EU-1234567890')).toBe('https://eu.aptabase.com/api/v0/event');
    expect(endpointFor('A-US-42')).toBe('https://us.aptabase.com/api/v0/event');
    expect(endpointFor('')).toBeNull();
    expect(endpointFor('A-SH-123')).toBeNull();
  });
  it('keeps a session for an hour of quiet, then starts a new one', () => {
    const a = nextSession(null, 1_000_000_000_000, () => 0.5);
    expect(a.id).toBe('100000000050000000');
    expect(nextSession(a, a.last + 3_000_000).id).toBe(a.id);
    expect(nextSession(a, a.last + 3_700_000, () => 0.1).id).not.toBe(a.id);
  });
  it('builds an event in the shape Aptabase takes', () => {
    const e = buildEvent('tally_started', { drill: 'custom', name: 'x' }, { sessionId: 's', now: new Date('2026-10-22T00:00:00Z'), locale: 'en-US', appVersion: '0.1.20', isDebug: false });
    expect(e).toEqual({ timestamp: '2026-10-22T00:00:00.000Z', sessionId: 's', eventName: 'tally_started',
      systemProps: { locale: 'en-US', isDebug: false, appVersion: '0.1.20', sdkVersion: 'electro-coach@1' }, props: { drill: 'custom' } });
  });
});
