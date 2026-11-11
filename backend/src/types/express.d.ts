import type { Role } from '@prisma/client';

/**
 * Rozszerzenie typu Request Express o dane zalogowanego uzytkownika.
 * Ustawiane przez middleware `authenticate`. Dzieki temu w kontrolerach
 * mamy `req.user` z pelnym typowaniem (bez `any`).
 */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        /** Id administratora, gdy to sesja podgladu (impersonacja) — tylko do odczytu. */
        impersonatedBy?: string;
      };
    }
  }
}

export {};
