import { describe, expect, it } from 'vitest';
import { sectionIssues, type IssueSection } from './planIssues';

// Cwiczenia grupy C-A (30 osob, semestry 1-7) prowadzone przez i1, w sali cwiczeniowej na 40 miejsc.
const ok: IssueSection = {
  classType: 'EXERCISE',
  hours: 30,
  group: { size: 30, fromSemester: 1, toSemester: null },
  instructors: [{ instructorId: 'i1', hours: 30 }],
  placements: [{ id: 'p1', instructorId: 'i1', instructorName: 'dr Nowak', room: { number: '112', type: 'EXERCISE', capacity: 40 } }],
};
const kinds = (s: IssueSection, semester = 3) => sectionIssues(s, semester).map((i) => i.kind);

describe('sectionIssues', () => {
  it('zgodny plan — bez uwag', () => {
    expect(sectionIssues(ok, 3)).toEqual([]);
  });

  it('prowadzacy umieszczenia zdjety z obsady', () => {
    const issues = sectionIssues({ ...ok, instructors: [{ instructorId: 'i2', hours: 30 }] }, 3);
    expect(issues).toEqual([
      { kind: 'INSTRUCTOR_NOT_STAFFED', placementId: 'p1', message: expect.stringContaining('dr Nowak nie jest juz w obsadzie') },
    ]);
  });

  it('umieszczenie NN (bez prowadzacego) nie jest niezgodne', () => {
    expect(kinds({ ...ok, placements: [{ ...ok.placements[0]!, instructorId: null }] })).toEqual([]);
  });

  it('umieszczenie poza dniami/oknem siatki', () => {
    const issues = sectionIssues({ ...ok, placements: [{ ...ok.placements[0]!, gridProblem: 'piatek: zajecia od 16:00' }] }, 3);
    expect(issues).toEqual([{ kind: 'OUTSIDE_GRID', placementId: 'p1', message: expect.stringContaining('wydzialu: piatek: zajecia od 16:00 —') }]);
  });

  it('sala innego typu i za mala', () => {
    const lab = { ...ok.placements[0]!, room: { number: '5', type: 'LAB' as const, capacity: 20 } };
    expect(kinds({ ...ok, placements: [lab] })).toEqual(['ROOM_TYPE', 'ROOM_CAPACITY']);
  });

  it('zajecia online (bez sali) — bez uwag o sali', () => {
    expect(kinds({ ...ok, placements: [{ ...ok.placements[0]!, room: null }] })).toEqual([]);
  });

  it('grupa poza semestrem: tylko gdy zajecia sa w planie', () => {
    const ended = { ...ok, group: { ...ok.group, toSemester: 2 } };
    expect(sectionIssues(ended, 3)).toEqual([
      expect.objectContaining({ kind: 'GROUP_INACTIVE', placementId: null, message: expect.stringContaining('semestrach 1-2') }),
    ]);
    expect(kinds({ ...ended, placements: [] })).toEqual([]);
  });

  it('obsada ponad godziny zajec (np. po synchronizacji)', () => {
    const issues = sectionIssues({ ...ok, hours: 20 }, 3);
    expect(issues).toEqual([expect.objectContaining({ kind: 'STAFF_HOURS', message: expect.stringContaining('Obsada ma 30 h, a zajecia 20 h') })]);
  });
});
