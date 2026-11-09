import { describe, expect, it } from 'vitest';
import { matchesAllWords } from './searchMatch';

describe('matchesAllWords', () => {
  it('fragmenty, nie rozrzucone litery', () => {
    expect(matchesAllWords('Aula — Aula Główna (320 miejsc)', 'Aula')).toBe(true);
    expect(matchesAllWords('111 — Centrum Symulatorowe (WN) (80 miejsc)', 'Aula')).toBe(false);
  });

  it('kazde slowo w dowolnej kolejnosci', () => {
    expect(matchesAllWords('112 — Budynek A (WM) (60 miejsc)', 'wm 112')).toBe(true);
    expect(matchesAllWords('112 — Budynek A (WM) (60 miejsc)', 'wm 113')).toBe(false);
  });

  it('bez wielkosci liter i polskich znakow', () => {
    expect(matchesAllWords('dr inż. Łukasz Wróblewski', 'lukasz wroblewski')).toBe(true);
    expect(matchesAllWords('Ochrona własności intelektualnej', 'WLASNOSCI')).toBe(true);
  });

  it('pusty tekst wyszukiwania pasuje do wszystkiego', () => {
    expect(matchesAllWords('cokolwiek', '  ')).toBe(true);
  });
});
