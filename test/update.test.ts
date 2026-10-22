import { describe, expect, it } from 'vitest';
import { isNewer, parseVersion, readRelease, shouldPrompt, whatsNew } from '../src/engine/update';

const gh = (tag: string, extra: object = {}) => ({
  tag_name: tag, html_url: `https://github.com/lvandrews/Electro-Coach-App/releases/tag/${tag}`, published_at: '2026-10-22T20:00:00Z',
  body: "Download it on your phone.\n\n## What's new\n\nBowling drill moves to Practice\n\n- one\n- two",
  assets: [{ name: `electro-coach-${tag.slice(1)}.apk`, browser_download_url: `https://github.com/lvandrews/Electro-Coach-App/releases/download/${tag}/electro-coach-${tag.slice(1)}.apk` }],
  ...extra,
});

describe('update check', () => {
  it('compares versions numerically', () => {
    expect(parseVersion('v0.1.21')).toEqual([0, 1, 21]);
    expect(isNewer('v0.1.21', '0.1.9')).toBe(true);
    expect(isNewer('0.1.20', '0.1.20')).toBe(false);
    expect(isNewer('0.1.19', '0.1.20')).toBe(false);
    expect(isNewer('0.2.0', '0.1.99')).toBe(true);
    expect(isNewer('0.1.21', 'web')).toBe(false);
    expect(isNewer('latest', '0.1.20')).toBe(false);
  });
  it('reads a GitHub release', () => {
    const r = readRelease(gh('v0.1.21'))!;
    expect(r.version).toBe('0.1.21');
    expect(r.apkUrl).toMatch(/electro-coach-0\.1\.21\.apk$/);
    expect(r.notes).toBe('Bowling drill moves to Practice\n\n- one\n- two');
    expect(readRelease(gh('v0.1.21', { draft: true }))).toBeNull();
    expect(readRelease(gh('nightly'))).toBeNull();
    expect(readRelease(gh('v0.1.21', { assets: [{ name: 'x.apk', browser_download_url: 'https://evil.example/x.apk' }] }))!.apkUrl).toBeNull();
  });
  it('finds "What\'s new" only when present', () => {
    expect(whatsNew('Download it.')).toBe('');
    expect(whatsNew("x\r\n### What's new\r\nA\r\nB")).toBe('A\nB');
  });
  it('respects Not now and Skip', () => {
    const r = readRelease(gh('v0.1.21'))!, now = Date.now();
    expect(shouldPrompt(r, '0.1.20', {}, now)).toBe(true);
    expect(shouldPrompt(r, '0.1.21', {}, now)).toBe(false);
    expect(shouldPrompt(r, '0.1.20', { snoozedUntil: now + 1000 }, now)).toBe(false);
    expect(shouldPrompt(r, '0.1.20', { snoozedUntil: now - 1000 }, now)).toBe(true);
    expect(shouldPrompt(r, '0.1.20', { skipped: '0.1.21' }, now)).toBe(false);
    expect(shouldPrompt(readRelease(gh('v0.1.22'))!, '0.1.20', { skipped: '0.1.21' }, now)).toBe(true);
  });
});
