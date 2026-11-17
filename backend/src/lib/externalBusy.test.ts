import { describe, expect, it } from 'vitest';
import { externalBusyProblems, externalClashes, externalLabel, normalizeDates, type ExternalBusyEntry } from './externalBusy';
import { findConflict, type BusySlot } from './materializer';
import { conflictMessage } from './conflictMessage';

const entry = (over: Partial<ExternalBusyEntry> = {}): ExternalBusyEntry => ({
  id: 'x1',
  source: 'WE – dziekanat',
  receivedOn: '2027-02-10',
  instructorId: 'i1',
  roomId: null,
  startMinute: 600, // 10:00
  endMinute: 690, // 11:30
  dates: ['2027-03-01', '2027-03-08'],
  note: null,
  ...over,
});

const slot = (over: Partial<BusySlot> = {}): BusySlot => ({
  date: '2027-03-01',
  startMinute: 660,
  endMinute: 720,
  roomId: 'r1',
  instructorId: 'i1',
  groupId: 'g1',
  jointKey: null,
  label: 'MiBM-S1 s2: Mechanika (W) MiBM-S1-2',
  ...over,
});

describe('externalLabel', () => {
  it('zrodlo, stan na i uwaga', () => {
    expect(externalLabel(entry())).toBe('zajecia poza wydzialem (WE – dziekanat, stan na 10.02)');
    expect(externalLabel(entry({ note: ' wyklad ' }))).toBe('zajecia poza wydzialem (WE – dziekanat, stan na 10.02): wyklad');
  });
});

describe('externalBusyProblems', () => {
  const ok = { instructorId: 'i1', roomId: null, startMinute: 600, endMinute: 690, dates: ['2027-03-01'] };
  it('poprawny wpis', () => expect(externalBusyProblems(ok)).toEqual([]));
  it('bez prowadzacego i sali', () => expect(externalBusyProblems({ ...ok, instructorId: null })[0]).toMatch(/prowadzacego albo sale/));
  it('koniec przed poczatkiem', () => expect(externalBusyProblems({ ...ok, endMinute: 600 })[0]).toMatch(/pozniejsza/));
  it('bez dat i ze zla data', () => {
    expect(externalBusyProblems({ ...ok, dates: [] })[0]).toMatch(/co najmniej jedna/);
    expect(externalBusyProblems({ ...ok, dates: ['2027-02-30'] })[0]).toMatch(/Nieprawidlowa data/);
  });
});

it('normalizeDates: bez powtorzen, rosnaco', () => {
  expect(normalizeDates(['2027-03-08', '2027-03-01', '2027-03-08'])).toEqual(['2027-03-01', '2027-03-08']);
});

describe('externalClashes — kolizje wpisu z ulozonym planem', () => {
  it('prowadzacy i sala na nakladajacych sie minutach tej samej daty', () => {
    expect(externalClashes(entry(), [slot()])).toEqual([{ date: '2027-03-01', reason: 'INSTRUCTOR', with: slot().label }]);
    expect(externalClashes(entry({ instructorId: null, roomId: 'r1' }), [slot()])).toEqual([{ date: '2027-03-01', reason: 'ROOM', with: slot().label }]);
  });

  it('inna data, styk godzin albo inny zasob — bez kolizji', () => {
    expect(externalClashes(entry(), [slot({ date: '2027-03-02' })])).toEqual([]);
    expect(externalClashes(entry(), [slot({ startMinute: 690, endMinute: 780 })])).toEqual([]);
    expect(externalClashes(entry(), [slot({ instructorId: 'i2' })])).toEqual([]);
  });

  it('ten sam termin z wzorca i z wygenerowanych terminow liczy sie raz', () => {
    expect(externalClashes(entry(), [slot(), slot()])).toHaveLength(1);
  });
});

describe('findConflict z zajetoscia zewnetrzna', () => {
  const external: BusySlot = { ...slot(), groupId: null, roomId: null, label: externalLabel(entry()) };
  const candidate = { date: '2027-03-01', startMinute: 660, endMinute: 720, roomId: 'r9', instructorId: 'i1', groupId: 'g1', jointKey: null };

  it('koliduje prowadzacym', () => {
    expect(findConflict(candidate, [external], () => true)).toEqual({ reason: 'INSTRUCTOR', with: external.label });
  });

  it('bez grupy nie koliduje grupowo', () => {
    expect(findConflict({ ...candidate, instructorId: 'i2' }, [external], () => true)).toBeNull();
  });

  it('komunikat bez podpowiedzi o zajeciach laczonych', () => {
    const message = conflictMessage([{ date: '2027-03-01', reason: 'INSTRUCTOR', with: external.label }]);
    expect(message).toMatch(/Prowadzacy ma wtedy zajecia — zajecia poza wydzialem/);
    expect(message).not.toMatch(/Zajecia laczone/);
  });
});
