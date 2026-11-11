/** Odmiana po liczbie: 1 rocznik, 2-4 roczniki, 5+ rocznikow (12-14 jak 5+). Jak frontend/src/lib/setupSteps. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  const lastTwo = n % 100;
  const last = n % 10;
  return `${n} ${last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many}`;
}
