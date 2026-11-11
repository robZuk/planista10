import { describe, expect, it } from 'vitest';
import type { PlanSection } from '@/types';
import { issueRows, placementWarning, planDays } from './planIssues';

const section = (id: string, issues: PlanSection['issues']) => ({ id, issues }) as PlanSection;

describe('placementWarning', () => {
  it('wlasne niezgodnosci umieszczenia i niezgodnosci calych zajec', () => {
    const s = section('s1', [
      { kind: 'ROOM_CAPACITY', placementId: 'p1', message: 'Sala 112 ma 20 miejsc, grupa 30 osob' },
      { kind: 'ROOM_TYPE', placementId: 'p2', message: 'Sala 5 nie pasuje' },
      { kind: 'STAFF_HOURS', placementId: null, message: 'Obsada ma 30 h, a zajecia 20 h' },
    ]);
    expect(placementWarning(s, 'p1')).toBe('Sala 112 ma 20 miejsc, grupa 30 osob\nObsada ma 30 h, a zajecia 20 h');
    expect(placementWarning(s, 'p3')).toBe('Obsada ma 30 h, a zajecia 20 h');
  });

  it('bez niezgodnosci — bez znacznika', () => {
    expect(placementWarning(section('s1', []), 'p1')).toBeNull();
  });
});

describe('issueRows', () => {
  it('splaszcza niezgodnosci w kolejnosci zajec', () => {
    const rows = issueRows([
      section('a', [{ kind: 'ROOM_TYPE', placementId: 'p1', message: 'x' }]),
      section('b', []),
      section('c', [
        { kind: 'GROUP_INACTIVE', placementId: null, message: 'y' },
        { kind: 'STAFF_HOURS', placementId: null, message: 'z' },
      ]),
    ]);
    expect(rows.map((r) => [r.section.id, r.message])).toEqual([['a', 'x'], ['c', 'y'], ['c', 'z']]);
  });
});

describe('planDays', () => {
  const at = (dayOfWeek: 'MONDAY' | 'FRIDAY' | 'SATURDAY') => ({ placements: [{ dayOfWeek }] }) as never;
  it('dni siatki w kolejnosci tygodnia', () => {
    expect(planDays(['SATURDAY', 'FRIDAY'], [])).toEqual(['FRIDAY', 'SATURDAY']);
  });
  it('dzien z umieszczeniem spoza siatki zostaje kolumna', () => {
    expect(planDays(['MONDAY'], [at('FRIDAY'), at('MONDAY')])).toEqual(['MONDAY', 'FRIDAY']);
  });
});
