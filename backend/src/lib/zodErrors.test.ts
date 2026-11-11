import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatZodIssue, installPolishZodErrors } from './zodErrors';

const error = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? null : formatZodIssue(result.error.issues[0]!);
};

beforeAll(() => installPolishZodErrors());

describe('bledy walidacji API po polsku', () => {
  it('liczby z polska nazwa pola', () => {
    expect(error(z.object({ semester: z.number().int().min(1) }), { semester: 0 })).toBe('Semestr: Wartosc nie moze byc mniejsza niz 1');
    expect(error(z.object({ ects: z.number().int().max(60) }), { ects: 61 })).toBe('ECTS: Wartosc nie moze byc wieksza niz 60');
    expect(error(z.object({ capacity: z.number().int() }), { capacity: 'x' })).toBe('Pojemnosc: Podaj liczbe');
  });

  it('pole w liscie dostaje numer pozycji', () => {
    const schema = z.object({ breaks: z.array(z.object({ name: z.string().max(3) })) });
    expect(error(schema, { breaks: [{ name: 'ok' }, { name: 'za dluga' }] })).toBe('Przerwy (2.) — Nazwa: Wpisz najwyzej 3 znaki');
  });

  it('brak pola, nieznane pole i komunikat ze schematu', () => {
    expect(error(z.object({ name: z.string() }), {})).toBe('Nazwa: Pole jest wymagane');
    expect(error(z.object({ foo: z.string().min(1) }), { foo: '' })).toBe('foo: Pole nie moze byc puste');
    expect(error(z.object({ subjectId: z.string().min(1, 'Wybierz przedmiot') }), { subjectId: '' })).toBe('Przedmiot: Wybierz przedmiot');
  });
});
