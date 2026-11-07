import { describe, expect, it } from 'vitest';
import { fitGridLines } from './scheduleDisplay';

describe('fitGridLines', () => {
  const lines = ['DUT-5-C-A', 'A101 (Budynek A)', 'mgr Zbigniew Adamski · co tydzien'];

  it('mieszcza sie -> bez zmian', () => {
    expect(fitGridLines(lines, 3)).toEqual(lines);
    expect(fitGridLines(lines, 5)).toEqual(lines);
  });

  it('za malo miejsca -> ogon sklejony w ostatniej linii', () => {
    expect(fitGridLines(lines, 2)).toEqual(['DUT-5-C-A', 'A101 (Budynek A) · mgr Zbigniew Adamski · co tydzien']);
    expect(fitGridLines(lines, 1)).toEqual(['DUT-5-C-A · A101 (Budynek A) · mgr Zbigniew Adamski · co tydzien']);
  });

  it('brak miejsca -> brak linii', () => {
    expect(fitGridLines(lines, 0)).toEqual([]);
  });
});
