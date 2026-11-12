import { describe, expect, it } from 'vitest';
import { instructorCreateSchema } from './instructor';
import { buildingCreateSchema } from './building';

// Limity dlugosci pol tekstowych — bez nich 5000-znakowe imie trafialo do bazy i rozbijalo UI.
describe('schematy — limity dlugosci', () => {
  it('prowadzacy: imie najwyzej 80 znakow, przyciete z bialych znakow', () => {
    expect(instructorCreateSchema.safeParse({ firstName: 'A'.repeat(81), lastName: 'B', email: 'a@b.pl' }).success).toBe(false);
    const ok = instructorCreateSchema.parse({ firstName: '  Anna  ', lastName: 'Nowak', email: 'a@b.pl' });
    expect(ok.firstName).toBe('Anna');
  });

  it('budynek: nazwa najwyzej 120 znakow', () => {
    expect(buildingCreateSchema.safeParse({ name: 'X'.repeat(121) }).success).toBe(false);
  });
});
