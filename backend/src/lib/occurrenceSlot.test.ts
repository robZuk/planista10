import { describe, expect, it } from 'vitest';
import { assessSlot } from './occurrenceSlot';

const teaching = { teaching: true, reason: null, label: null };

describe('assessSlot', () => {
  it('zwykly dzien zajec w oknie godzin — bez uwag', () => {
    expect(assessSlot(teaching, null)).toEqual({ blocking: null, warnings: [] });
  });

  it('data poza semestrem blokuje', () => {
    expect(assessSlot({ teaching: false, reason: 'OUT_OF_RANGE', label: null }, 'piatek: zajecia od 16:00')).toEqual({
      blocking: 'Data poza semestrem',
      warnings: [],
    });
  });

  it('swieto, przerwa i dzien wolny to ostrzezenia z nazwa dnia', () => {
    expect(assessSlot({ teaching: false, reason: 'HOLIDAY', label: 'Narodowe Swieto Niepodleglosci' }, null).warnings).toEqual([
      'Dzien wolny: Narodowe Swieto Niepodleglosci',
    ]);
    expect(assessSlot({ teaching: false, reason: 'BREAK', label: null }, null).warnings).toEqual(['Dzien wolny: bez zajec']);
  });

  it('dzien poza zjazdami i dzien tygodnia bez zajec trybu', () => {
    expect(assessSlot({ teaching: false, reason: 'NO_ZJAZD', label: null }, null).warnings).toEqual(['Dzien poza zjazdami rocznika']);
    expect(assessSlot({ teaching: false, reason: 'NOT_MODE_DAY', label: null }, null).warnings).toEqual([
      'Rocznik nie ma zajec w ten dzien tygodnia',
    ]);
  });

  it('dzien bez zajec w siatce — komunikat siatki bez dopisku', () => {
    const msg = 'Siatka nie przewiduje zajec w dniu: sroda (dni: piatek, sobota, niedziela)';
    expect(assessSlot(teaching, msg).warnings).toEqual([msg]);
  });

  it('godziny poza oknem dnia dokladaja ostrzezenie', () => {
    expect(assessSlot(teaching, 'piatek: zajecia od 16:00')).toEqual({
      blocking: null,
      warnings: ['Poza godzinami zajec — piatek: zajecia od 16:00'],
    });
  });
});
