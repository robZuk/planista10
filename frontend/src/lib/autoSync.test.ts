import { describe, expect, it } from 'vitest';
import { appliedText, pendingText } from './autoSync';

const none = { created: 0, reactivated: 0, hoursChanged: 0, pending: 0 };

describe('appliedText', () => {
  it('nic sie nie zmienilo albo brak podsumowania — bez dopisku', () => {
    expect(appliedText(undefined)).toBeNull();
    expect(appliedText(none)).toBeNull();
    expect(appliedText({ ...none, pending: 2 })).toBeNull();
  });

  it('nowe i poprawione zajecia', () => {
    expect(appliedText({ ...none, created: 29 })).toBe('zajecia semestru: +29');
    expect(appliedText({ ...none, created: 2, reactivated: 1, hoursChanged: 2 })).toBe('zajecia semestru: +2, poprawione 3');
  });
});

describe('pendingText', () => {
  it('tylko gdy cos czeka na decyzje, z odmiana', () => {
    expect(pendingText(undefined)).toBeNull();
    expect(pendingText(none)).toBeNull();
    expect(pendingText({ ...none, pending: 1 })).toMatch(/^1 zmiana zajec czeka na Twoja decyzje/);
    expect(pendingText({ ...none, pending: 3 })).toMatch(/^3 zmiany zajec czekaja/);
    expect(pendingText({ ...none, pending: 5 })).toMatch(/^5 zmian zajec czeka/);
  });
});
