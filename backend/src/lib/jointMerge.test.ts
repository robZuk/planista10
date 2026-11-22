import { describe, expect, it } from 'vitest';
import { joinUnique, mergeJoint, type JointSlot } from './jointMerge';

type Row = JointSlot & { id: string; group: string };

const row = (id: string, group: string, over: Partial<JointSlot> = {}): Row => ({
  id,
  group,
  date: '2026-11-22',
  startMinute: 825,
  endMinute: 970,
  jointKey: 'RYN-OZE',
  roomId: 'A219',
  instructorId: 'molenda',
  ...over,
});

const merge = (first: Row, rest: Row[]): Row => ({ ...first, group: joinUnique([first.group, ...rest.map((r) => r.group)]) });

describe('mergeJoint — zajecia laczone jako jedne zajecia', () => {
  it('scala grupy tych samych zajec laczonych, reszta bez zmian i w kolejnosci', () => {
    const rows = [row('1', 'MEN', { jointKey: null }), row('2', 'MEN'), row('3', 'EKS'), row('4', 'C-1', { jointKey: null })];
    const merged = mergeJoint(rows, (r) => r, merge);
    expect(merged.map((r) => [r.id, r.group])).toEqual([
      ['1', 'MEN'],
      ['2', 'EKS, MEN'],
      ['4', 'C-1'],
    ]);
  });

  it('ten sam klucz w innym czasie, sali albo dniu to osobne zajecia', () => {
    const rows = [row('1', 'MEN'), row('2', 'EKS', { startMinute: 635 }), row('3', 'EKS', { roomId: 'A015' }), row('4', 'EKS', { date: '2026-11-21' })];
    expect(mergeJoint(rows, (r) => r, merge)).toHaveLength(4);
  });
});
