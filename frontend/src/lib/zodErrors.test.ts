import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { installPolishZodErrors } from './zodErrors';

const message = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? null : result.error.issues[0]!.message;
};

beforeAll(() => installPolishZodErrors());

describe('polskie komunikaty walidacji', () => {
  it('liczby: zakres, calkowite, puste pole (NaN z valueAsNumber)', () => {
    expect(message(z.number().int().min(0), -3)).toBe('Wartosc nie moze byc mniejsza niz 0');
    expect(message(z.number().int().max(60), 61)).toBe('Wartosc nie moze byc wieksza niz 60');
    expect(message(z.number().int(), 1.5)).toBe('Podaj liczbe calkowita');
    expect(message(z.number(), Number.NaN)).toBe('Podaj liczbe');
    expect(message(z.number().positive(), 0)).toBe('Wartosc musi byc wieksza niz 0');
  });

  it('teksty, e-mail i wybor z listy', () => {
    expect(message(z.string().min(1), '')).toBe('Uzupelnij to pole');
    expect(message(z.string().min(3), 'ab')).toBe('Wpisz co najmniej 3 znaki');
    expect(message(z.string().max(5), 'abcdef')).toBe('Wpisz najwyzej 5 znakow');
    expect(message(z.email(), 'x')).toBe('To nie wyglada na adres email');
    expect(message(z.enum(['A', 'B']), 'C')).toBe('Wybierz jedna z dostepnych opcji');
  });

  it('komunikat podany w schemacie ma pierwszenstwo', () => {
    expect(message(z.string().min(1, 'Wybierz przedmiot'), '')).toBe('Wybierz przedmiot');
  });
});
