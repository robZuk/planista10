import type { Request } from 'express';
import { AppError } from './AppError';
import { getCallerFacultyId } from './callerFaculty';

/**
 * Zakres wydzialu wywolujacego — jedno miejsce zamiast powtarzanych blokow
 * `if (role === 'DEAN_OFFICE') { getCallerFacultyId ... }` w kontrolerach.
 *
 * ADMIN dziala na calej uczelni. DEAN_OFFICE (planista wydzialu) — wylacznie na
 * swoim wydziale; konto dziekanatu bez przypisanego wydzialu nie moze niczego zmieniac.
 */
export interface CallerScope {
  isAdmin: boolean;
  isPlanner: boolean;
  /** Wydzial konta (null dla admina i kont bez wydzialu). */
  facultyId: string | null;
}

export async function getCallerScope(req: Request): Promise<CallerScope> {
  const role = req.user!.role;
  const isAdmin = role === 'ADMIN';
  return {
    isAdmin,
    isPlanner: isAdmin || role === 'DEAN_OFFICE',
    facultyId: isAdmin ? null : await getCallerFacultyId(req.user!.id),
  };
}

/** Rzuca 403, jesli wywolujacy nie moze zmieniac danych wskazanego wydzialu. */
export async function assertFacultyScope(req: Request, facultyId: string): Promise<void> {
  const role = req.user!.role;
  if (role === 'ADMIN') return;
  if (role !== 'DEAN_OFFICE') throw new AppError(403, 'Brak uprawnien do tej operacji');
  const own = await getCallerFacultyId(req.user!.id);
  if (!own) throw new AppError(403, 'Konto dziekanatu nie ma przypisanego wydzialu');
  if (own !== facultyId) throw new AppError(403, 'Mozesz zmieniac tylko dane swojego wydzialu');
}
