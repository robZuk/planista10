import { describe, expect, it } from 'vitest';
import { plural } from './plural';

describe('plural', () => {
  const r = (n: number) => plural(n, 'rocznik', 'roczniki', 'rocznikow');
  it('1 / 2-4 / 5+ / 12-14 / 22', () => {
    expect([r(1), r(3), r(5), r(12), r(22), r(0)]).toEqual(['1 rocznik', '3 roczniki', '5 rocznikow', '12 rocznikow', '22 roczniki', '0 rocznikow']);
  });
});
