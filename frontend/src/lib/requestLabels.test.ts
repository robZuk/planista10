import { describe, expect, it } from 'vitest';
import { formatDate, timeAgo } from './requestLabels';

describe('requestLabels', () => {
  it('data dd.mm.rrrr', () => expect(formatDate('2026-11-12')).toBe('12.11.2026'));

  it('wiek powiadomienia', () => {
    const now = new Date('2026-11-09T12:00:00Z');
    expect(timeAgo('2026-11-09T11:59:40Z', now)).toBe('przed chwila');
    expect(timeAgo('2026-11-09T11:55:00Z', now)).toBe('5 min temu');
    expect(timeAgo('2026-11-09T09:00:00Z', now)).toBe('3 godz. temu');
    expect(timeAgo('2026-11-08T10:00:00Z', now)).toBe('wczoraj');
    expect(timeAgo('2026-11-06T10:00:00Z', now)).toBe('3 dni temu');
  });
});
