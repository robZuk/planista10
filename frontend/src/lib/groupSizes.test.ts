import { describe, expect, it } from 'vitest';
import { partitionOverflows } from './groupSizes';

describe('partitionOverflows', () => {
  const lab = (size: number) => ({ partitionKey: 'L', size });
  it('podgrupy mieszcza sie w grupie — pusto', () => {
    expect(partitionOverflows({ size: 18 }, [lab(9), lab(9)])).toEqual([]);
  });
  it('suma podzialu wieksza niz grupa', () => {
    expect(partitionOverflows({ size: 18 }, [lab(25), lab(9)])).toEqual([{ partitionKey: 'L', sum: 34 }]);
  });
  it('kazdy podzial liczony osobno', () => {
    expect(partitionOverflows({ size: 30 }, [lab(15), lab(15), { partitionKey: 'C', size: 20 }, { partitionKey: 'C', size: 20 }])).toEqual([
      { partitionKey: 'C', sum: 40 },
    ]);
  });
});
