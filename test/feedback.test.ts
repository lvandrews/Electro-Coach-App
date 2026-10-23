import { describe, it, expect } from 'vitest';
import { drillRequestUrl, isPoolBilliardsLink } from '../src/ui/FeedbackScreen';

describe('drill requests', () => {
  it('names the issue after the drill in the link and keeps the link in the body', () => {
    const u = new URL(drillRequestUrl('https://www.poolbilliards.co/drills/stop-shot-ladder', 'Great warm-up'));
    expect(u.searchParams.get('title')).toBe('Drill request: stop shot ladder');
    expect(u.searchParams.get('body')).toContain('https://www.poolbilliards.co/drills/stop-shot-ladder');
    expect(u.searchParams.get('body')).toContain('Great warm-up');
  });
  it('works from a description alone', () => {
    expect(new URL(drillRequestUrl('', 'Three-rail kick ladder')).searchParams.get('title')).toBe('Drill request: Three-rail kick ladder');
  });
  it('recognizes poolbilliards.co links', () => {
    expect(isPoolBilliardsLink('https://www.poolbilliards.co/x')).toBe(true);
    expect(isPoolBilliardsLink('poolbilliards.co/x')).toBe(true);
    expect(isPoolBilliardsLink('https://example.com/poolbilliards')).toBe(false);
  });
});
