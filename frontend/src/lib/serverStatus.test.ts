import { describe, expect, it } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { isServerUnavailable } from './serverStatus';

const withResponse = (status: number, data: unknown) =>
  new AxiosError('x', 'ERR', undefined, undefined, { status, data, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } });

describe('isServerUnavailable', () => {
  it('brak odpowiedzi (siec, wylaczony backend) — niedostepny', () => {
    expect(isServerUnavailable(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe(true);
  });
  it('502/503 z proxy bez naszej koperty bledu — niedostepny', () => {
    expect(isServerUnavailable(withResponse(502, 'Bad Gateway'))).toBe(true);
    expect(isServerUnavailable(withResponse(500, ''))).toBe(true);
  });
  it('bledy aplikacji — nie (obsluguja je strony)', () => {
    expect(isServerUnavailable(withResponse(409, { error: 'Kolizja' }))).toBe(false);
    expect(isServerUnavailable(withResponse(500, { error: 'Wewnetrzny blad serwera' }))).toBe(false);
    expect(isServerUnavailable(new Error('x'))).toBe(false);
  });
});
