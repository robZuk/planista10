import { describe, expect, it } from 'vitest';
import { JOINT_HINT, conflictMessage, conflictShort, datesList, shortDate, singleConflictMessage } from './conflictMessage';

const PKM = 'MIBM-N1 s3: Podst. konstr. maszyn I,II,III (C) TRUOiP-SN-3-C-A';
const c = (date: string, reason = 'GROUP', withWhat = PKM) => ({ date, reason, with: withWhat });

describe('daty', () => {
  it('krotki zapis bez roku i zer wiodacych w dniu', () => {
    expect(shortDate('2026-10-04')).toBe('4.10');
    expect(shortDate('2026-12-13')).toBe('13.12');
  });

  it('lista posortowana, bez powtorzen, reszta jako "i jeszcze N"', () => {
    expect(datesList(['2026-10-18', '2026-10-04', '2026-10-04'])).toBe('4.10, 18.10');
    expect(datesList(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'], 2)).toBe('4.10, 11.10 i jeszcze 2');
  });
});

describe('conflictMessage', () => {
  it('8 kolizji z tymi samymi zajeciami -> jeden wpis z datami (przypadek ze zrzutu)', () => {
    const dates = ['2026-10-04', '2026-10-18', '2026-11-15', '2026-11-22', '2026-12-06', '2026-12-13', '2027-01-10', '2027-01-24'];
    expect(conflictMessage(dates.map((d) => c(d)))).toBe(
      [
        'Kolizja w 8 terminach:',
        `• Grupa ma wtedy zajecia — ${PKM}`,
        '  daty: 4.10, 18.10, 15.11, 22.11, 6.12, 13.12 i jeszcze 2',
      ].join('\n'),
    );
  });

  it('rozne przyczyny: osobne wpisy, najczestsze najpierw', () => {
    const msg = conflictMessage([c('2026-10-04', 'ROOM', '112 (Budynek A)'), c('2026-10-11'), c('2026-10-18')]);
    expect(msg.split('\n')).toEqual([
      'Kolizja w 3 terminach:',
      `• Grupa ma wtedy zajecia — ${PKM}`,
      '  daty: 11.10, 18.10',
      '• Sala zajeta — 112 (Budynek A)',
      '  daty: 4.10',
      JOINT_HINT,
    ]);
  });

  it('kolizja prowadzacego podpowiada zajecia laczone; sama kolizja grupy — nie', () => {
    expect(conflictMessage([c('2026-10-04', 'INSTRUCTOR', 'ET-S1 s2: Podstawy elektrotechniki (W)')]).split('\n').at(-1)).toBe(JOINT_HINT);
    expect(conflictMessage([c('2026-10-04')])).not.toContain('Zajecia laczone');
  });

  it('liczba terminow to liczba dat (dwie kolizje jednego dnia = jeden termin)', () => {
    expect(conflictMessage([c('2026-10-04'), c('2026-10-04', 'ROOM', 'sala')])).toMatch(/^Kolizja w 1 terminie:/);
  });

  it('ponad 3 rodzaje kolizji: reszta podsumowana', () => {
    const msg = conflictMessage([
      c('2026-10-04', 'GROUP', 'A'),
      c('2026-10-05', 'GROUP', 'B'),
      c('2026-10-06', 'GROUP', 'C'),
      c('2026-10-07', 'GROUP', 'D'),
      c('2026-10-08', 'GROUP', 'E'),
    ]);
    expect(msg.split('\n').at(-1)).toBe('Pozostale kolizje: 2');
  });

  it('brak kolizji -> pusty tekst', () => expect(conflictMessage([])).toBe(''));
});

describe('pojedyncza i krotka', () => {
  it('pojedyncza kolizja bez kodow technicznych', () => {
    expect(singleConflictMessage({ reason: 'ROOM', with: '112 (Budynek A)' })).toBe('Kolizja: sala zajeta — 112 (Budynek A)');
    expect(singleConflictMessage({ reason: 'NIEZNANY', with: 'x' })).toBe('Kolizja: nieznany — x');
  });

  it('krotka w jednej linii: najczestsza kolizja i reszta', () => {
    expect(conflictShort([c('2026-10-04'), c('2026-10-18'), c('2026-10-25', 'ROOM', 'sala')])).toBe(
      `kolizja w 3 terminach — grupa ma wtedy zajecia: ${PKM} (4.10, 18.10); pozostale kolizje: 1`,
    );
  });
});

describe('kilka powodow z tymi samymi zajeciami', () => {
  it('laczy powody w jedno zdanie i daje podpowiedz o zajeciach laczonych', async () => {
    const { conflictReasonText, conflictMessage } = await import('./conflictMessage');
    expect(conflictReasonText('ROOM+GROUP')).toBe('Sala zajeta i grupa ma wtedy zajecia');
    expect(conflictReasonText('ROOM+INSTRUCTOR+GROUP')).toBe('Sala zajeta, prowadzacy ma wtedy zajecia i grupa ma wtedy zajecia');
    expect(conflictReasonText('GROUP')).toBe('Grupa ma wtedy zajecia');
    const msg = conflictMessage([{ date: '2027-02-22', reason: 'ROOM+GROUP', with: 'X' }]);
    expect(msg).toContain('• Sala zajeta i grupa ma wtedy zajecia — X');
    expect(msg).toContain('zajecia laczone');
  });
});
