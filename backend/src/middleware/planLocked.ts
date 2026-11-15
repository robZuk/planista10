import type { Request, RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { parseTermKey } from '../lib/terms';
import { withPlanLock } from '../services/planLock';

/**
 * Zapis planu pod blokada semestru (services/planLock): od kontroli kolizji do odpowiedzi.
 * `termOf` wskazuje semestr zadania (null — nie blokujemy, np. nie ma takiego zasobu: handler
 * i tak odpowie 404). Podglady (`dryRun` inne niz false) blokady nie biora.
 */
export function planLocked(termOf: (req: Request) => Promise<string | null>, opts: { onlyWrites?: boolean } = {}): RequestHandler {
  return (req, res, next) => {
    if (opts.onlyWrites && (req.body as { dryRun?: unknown } | undefined)?.dryRun !== false) return next();
    termOf(req)
      .then((termId) => {
        if (!termId) return next();
        return withPlanLock(
          termId,
          () =>
            new Promise<void>((resolve) => {
              res.once('finish', resolve);
              res.once('close', resolve);
              next();
            }),
        );
      })
      .catch(next);
  };
}

/** Semestr z adresu /terms/:key/... */
export async function termFromKey(req: Request): Promise<string | null> {
  const ref = parseTermKey(String(req.params.key));
  return ref ? ((await prisma.academicTerm.findUnique({ where: { startYear_type: ref }, select: { id: true } }))?.id ?? null) : null;
}

export const termOfPlacement = async (req: Request) =>
  (await prisma.placement.findUnique({ where: { id: String(req.params.id) }, select: { termId: true } }))?.termId ?? null;

export const termOfOccurrence = async (req: Request) =>
  (await prisma.occurrence.findUnique({ where: { id: String(req.params.id) }, select: { termId: true } }))?.termId ?? null;
