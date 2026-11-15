import { prisma } from '../lib/prisma';

/**
 * Zapisy planu semestru (umieszczenia, zmiany terminow, terminy reczne, generowanie, przeniesienie
 * planu, import obsady) ida po kolei w obrebie semestru. Kontrola kolizji i zapis to osobne
 * zapytania — bez tego dwa rownolegle zapisy (np. dwa dziekanaty) mogly oba przejsc kontrole
 * i zajac te sama sale o tej samej godzinie. Kolizje licza sie w calej uczelni, wiec klucz to semestr.
 *
 * Najpierw kolejka w procesie (czekajacy nie trzymaja polaczen z bazy), potem blokada doradcza
 * Postgresa na czas operacji — chroni tez, gdyby backend dzialal w kilku procesach. Zapisy w `fn`
 * ida zwyklym klientem i sa zatwierdzone, zanim blokada zostanie zwolniona.
 */
const queues = new Map<string, Promise<void>>();

export async function withPlanLock<T>(termId: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(termId) ?? Promise.resolve();
  let release!: () => void;
  const current = previous.then(() => new Promise<void>((resolve) => (release = resolve)));
  queues.set(termId, current);
  // Reakcja `then` powyzej zarejestrowana przed `await` — po nim `release` jest juz ustawione.
  await previous;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plan:${termId}`}))`;
        return fn();
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  } finally {
    release();
    if (queues.get(termId) === current) queues.delete(termId);
  }
}
