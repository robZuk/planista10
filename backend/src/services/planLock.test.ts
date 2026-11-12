import { describe, expect, it, vi } from 'vitest';

// Blokada zapisow planu: operacje tego samego semestru ida po kolei, rozne semestry — rownolegle.
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({ $executeRaw: vi.fn().mockResolvedValue(1) })),
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { withPlanLock } from './planLock';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('withPlanLock', () => {
  it('drugi zapis tego samego semestru czeka na pierwszy (kontrola kolizji widzi juz jego wynik)', async () => {
    const log: string[] = [];
    let finishFirst!: () => void;
    const first = withPlanLock('t1', async () => {
      log.push('1 start');
      await new Promise<void>((r) => (finishFirst = r));
      log.push('1 koniec');
    });
    const second = withPlanLock('t1', async () => {
      log.push('2 start');
    });
    await tick();
    expect(log).toEqual(['1 start']);
    finishFirst();
    await Promise.all([first, second]);
    expect(log).toEqual(['1 start', '1 koniec', '2 start']);
  });

  it('rozne semestry nie czekaja na siebie', async () => {
    const log: string[] = [];
    let finish!: () => void;
    const a = withPlanLock('tA', async () => {
      await new Promise<void>((r) => (finish = r));
      log.push('A');
    });
    await withPlanLock('tB', async () => {
      log.push('B');
    });
    expect(log).toEqual(['B']);
    finish();
    await a;
  });

  it('blad w zapisie zwalnia blokade dla kolejnych', async () => {
    await expect(withPlanLock('t2', async () => Promise.reject(new Error('kolizja')))).rejects.toThrow('kolizja');
    await expect(withPlanLock('t2', async () => 'ok')).resolves.toBe('ok');
  });
});
