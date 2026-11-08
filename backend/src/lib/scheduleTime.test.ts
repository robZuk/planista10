import { describe, it, expect } from 'vitest';
import { rangesOverlap } from './scheduleTime';

describe('rangesOverlap', () => {
  it('wykrywa nakladanie i stycznosc (przedzialy domkniete)', () => {
    expect(rangesOverlap(1, 2, 2, 3)).toBe(true); // stycznosc w punkcie 2
    expect(rangesOverlap(1, 3, 2, 2)).toBe(true); // zawieranie
    expect(rangesOverlap(1, 2, 3, 4)).toBe(false); // rozlaczne
    expect(rangesOverlap(3, 4, 1, 2)).toBe(false); // rozlaczne (odwrotna kolejnosc)
  });
});
