import { z } from 'zod';
import { plural } from './setupSteps';

// "co najmniej 3 znaki", "najwyzej 5 znakow", "najwyzej 1 znak".
const chars = (n: number) => plural(n, 'znak', 'znaki', 'znakow');

/**
 * Domyslne komunikaty walidacji po polsku (bez znakow diakrytycznych, jak reszta UI) dla
 * regul bez wlasnego komunikatu, np. `z.number().int().min(0)`. Wbudowana lokalizacja zoda
 * mowi "oczekiwano int" i "Zbyt mal(y/a/e)", a domyslna — po angielsku. Komunikat podany
 * w schemacie (`.min(1, 'Wybierz przedmiot')`) ma pierwszenstwo. Zwraca undefined, gdy
 * nie ma polskiego odpowiednika — wtedy zostaje komunikat domyslny.
 */
export function polishZodMessage(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.expected === 'number' || issue.expected === 'int') {
        return issue.expected === 'int' ? 'Podaj liczbe calkowita' : 'Podaj liczbe';
      }
      if (issue.expected === 'string') return 'Uzupelnij to pole';
      return 'Nieprawidlowa wartosc';
    case 'too_small':
      if (issue.origin === 'number' || issue.origin === 'int') {
        return issue.inclusive ? `Wartosc nie moze byc mniejsza niz ${issue.minimum}` : `Wartosc musi byc wieksza niz ${issue.minimum}`;
      }
      if (issue.origin === 'string') {
        return Number(issue.minimum) <= 1 ? 'Uzupelnij to pole' : `Wpisz co najmniej ${chars(Number(issue.minimum))}`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') return `Wybierz co najmniej ${issue.minimum}`;
      return undefined;
    case 'too_big':
      if (issue.origin === 'number' || issue.origin === 'int') {
        return issue.inclusive ? `Wartosc nie moze byc wieksza niz ${issue.maximum}` : `Wartosc musi byc mniejsza niz ${issue.maximum}`;
      }
      if (issue.origin === 'string') return `Wpisz najwyzej ${chars(Number(issue.maximum))}`;
      return undefined;
    case 'invalid_format':
      if (issue.format === 'email') return 'To nie wyglada na adres email';
      return 'Nieprawidlowy format';
    case 'invalid_value':
      return 'Wybierz jedna z dostepnych opcji';
    default:
      return undefined;
  }
}

export function installPolishZodErrors(): void {
  z.config({ customError: polishZodMessage });
}
