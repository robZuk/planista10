import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicTerm } from '@prisma/client';

// "Terminy nieaktualne" per rocznik — Prisma mockowana. Odtwarzamy dwa dawne bledy:
// generowanie jednego rocznika "odswiezalo" inne roczniki tego samego kalendarza, a
// "Przygotowanie semestru" nie widzialo zmiany godzin zajec (powod SECTIONS).
const prismaMock = vi.hoisted(() => ({
  classSection: { findMany: vi.fn() },
  placement: { groupBy: vi.fn() },
  occurrence: { groupBy: vi.fn() },
  cohortGeneration: { findMany: vi.fn() },
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { staleReasonsByCohort } from './staleness';

const term = { id: 't-2026Z' } as AcademicTerm;
const at = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00Z`);

/** Dane: sekcje (id, rocznik, updatedAt), zmiany umieszczen, terminy reczne, usuniecia, generowania. */
function given(data: {
  sections: { id: string; cohortId: string; updatedAt: Date }[];
  placements?: { sectionId: string; at: Date }[];
  manual?: string[];
  deletions?: { sectionId: string; at: Date }[];
  generations?: { cohortId: string; at: Date }[];
}) {
  prismaMock.classSection.findMany.mockResolvedValue(data.sections);
  prismaMock.placement.groupBy.mockResolvedValue((data.placements ?? []).map((p) => ({ sectionId: p.sectionId, _max: { updatedAt: p.at } })));
  prismaMock.occurrence.groupBy.mockImplementation((args: { where: { kind: string } }) =>
    Promise.resolve(
      args.where.kind === 'MANUAL'
        ? (data.manual ?? []).map((sectionId) => ({ sectionId, _count: { _all: 1 } }))
        : (data.deletions ?? []).map((d) => ({ sectionId: d.sectionId, _max: { updatedAt: d.at } })),
    ),
  );
  prismaMock.cohortGeneration.findMany.mockResolvedValue((data.generations ?? []).map((g) => ({ cohortId: g.cohortId, generatedAt: g.at })));
}

beforeEach(() => vi.clearAllMocks());

describe('staleReasonsByCohort', () => {
  it('generowanie jednego rocznika nie odswieza drugiego z tego samego kalendarza', async () => {
    // Oba roczniki zmienily wzorzec o 10:00; o 11:00 wygenerowano terminy tylko rocznikowi A.
    given({
      sections: [
        { id: 'sa', cohortId: 'A', updatedAt: at('08:00') },
        { id: 'sb', cohortId: 'B', updatedAt: at('08:00') },
      ],
      placements: [
        { sectionId: 'sa', at: at('10:00') },
        { sectionId: 'sb', at: at('10:00') },
      ],
      generations: [
        { cohortId: 'A', at: at('11:00') },
        { cohortId: 'B', at: at('09:00') },
      ],
    });
    const r = await staleReasonsByCohort(term, ['A', 'B']);
    expect(r.get('A')).toEqual([]);
    expect(r.get('B')).toEqual(['PLACEMENTS']);
  });

  it('zmiana godzin zajec w planie po generowaniu (synchronizacja) -> SECTIONS', async () => {
    given({
      sections: [
        { id: 'w-planie', cohortId: 'A', updatedAt: at('12:00') },
        { id: 'reczne', cohortId: 'B', updatedAt: at('12:00') },
        { id: 'poza-planem', cohortId: 'C', updatedAt: at('12:00') },
      ],
      placements: [{ sectionId: 'w-planie', at: at('08:00') }],
      manual: ['reczne'],
      generations: [
        { cohortId: 'A', at: at('09:00') },
        { cohortId: 'B', at: at('09:00') },
        { cohortId: 'C', at: at('09:00') },
      ],
    });
    const r = await staleReasonsByCohort(term, ['A', 'B', 'C']);
    expect(r.get('A')).toEqual(['SECTIONS']);
    expect(r.get('B')).toEqual(['SECTIONS']); // zajecia z terminami recznymi tez sa w planie
    expect(r.get('C')).toEqual([]); // nowe zajecia bez umieszczen nie unieaktualniaja terminow
  });

  it('usuniete umieszczenie po generowaniu -> DELETED; rocznik nigdy nie generowany z wzorcem -> PLACEMENTS', async () => {
    given({
      sections: [
        { id: 'sa', cohortId: 'A', updatedAt: at('08:00') },
        { id: 'sn', cohortId: 'N', updatedAt: at('08:00') },
      ],
      placements: [{ sectionId: 'sn', at: at('08:30') }],
      deletions: [{ sectionId: 'sa', at: at('10:00') }],
      generations: [{ cohortId: 'A', at: at('09:00') }],
    });
    const r = await staleReasonsByCohort(term, ['A', 'N', 'pusty']);
    expect(r.get('A')).toEqual(['DELETED']);
    expect(r.get('N')).toEqual(['PLACEMENTS']);
    expect(r.get('pusty')).toEqual([]);
  });

  it('pusta lista rocznikow — bez zapytan', async () => {
    expect((await staleReasonsByCohort(term, [])).size).toBe(0);
    expect(prismaMock.classSection.findMany).not.toHaveBeenCalled();
  });
});
