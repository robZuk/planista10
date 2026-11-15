import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt';

/** Metody bez skutkow ubocznych — jedyne dozwolone w sesji podgladu. */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Middleware uwierzytelniania.
 * Oczekuje naglowka `Authorization: Bearer <accessToken>`. Po weryfikacji
 * ustawia `req.user = { id, role }`. W razie braku/niewaznosci -> 401.
 *
 * Token podgladu (impersonacja, `imp` = id admina) jest tylko do odczytu: zapis
 * w podgladzie wygladalby w bazie jak dzialanie podgladanej osoby (np. zmiana
 * planu przez dziekanat) -> 403.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Brak tokenu uwierzytelniajacego' });
    return;
  }

  const token = header.slice('Bearer '.length);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, ...(payload.imp ? { impersonatedBy: payload.imp } : {}) };
  } catch {
    res.status(401).json({ error: 'Token niewazny lub wygasly' });
    return;
  }
  if (req.user.impersonatedBy && !READ_ONLY_METHODS.has(req.method)) {
    res.status(403).json({ error: 'Podglad jest tylko do odczytu — wroc do swojego konta, zeby cos zmienic' });
    return;
  }
  next();
}

/**
 * Middleware autoryzacji — dopuszcza tylko wskazane role.
 * Uzycie: router.post('/x', authenticate, authorize('ADMIN'), handler)
 * Zaklada, ze `authenticate` uruchomiono wczesniej (jest `req.user`).
 */
export function authorize(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Wymagane uwierzytelnienie' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Brak uprawnien do tej operacji' });
      return;
    }
    next();
  };
}
