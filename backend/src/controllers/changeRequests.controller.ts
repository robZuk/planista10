import type { Request } from 'express';
import type { ChangeRequestStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { assertFacultyScope, getCallerScope } from '../lib/facultyScope';
import { parseTermKey } from '../lib/terms';
import type { RequestInput } from '../lib/changeRequests';
import {
  approveRequest,
  createRequest,
  listMakeups,
  listRequests,
  rejectRequest,
  requestOptions,
  withdrawRequest,
  type DecisionOverride,
} from '../services/changeRequests';

/**
 * Zgloszenia zmian prowadzacych i lista zajec do odrobienia. Prowadzacy: swoje zgloszenia
 * i odwolane zajecia; dziekanat: swojego wydzialu (zatwierdza / odrzuca); admin: wszystkie
 * albo wybranego wydzialu.
 */

async function findTerm(key: string) {
  const ref = parseTermKey(key);
  if (!ref) throw new AppError(400, 'Nieprawidlowy klucz semestru');
  const term = await prisma.academicTerm.findUnique({ where: { startYear_type: ref } });
  if (!term) throw new AppError(404, 'Semestr nie istnieje');
  return term;
}

async function caller(req: Request) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, role: true, instructorId: true } });
  if (!user) throw new AppError(401, 'Brak uzytkownika');
  return user;
}

/** Zakres listy wg roli: prowadzacy — on sam; dziekanat — jego wydzial; admin — ?facultyId albo wszystko. */
async function listScope(req: Request): Promise<{ instructorId?: string; facultyId?: string | null }> {
  const user = await caller(req);
  if (user.role === 'INSTRUCTOR') {
    if (!user.instructorId) throw new AppError(403, 'Konto nie jest powiazane z prowadzacym');
    return { instructorId: user.instructorId };
  }
  const scope = await getCallerScope(req);
  if (scope.isAdmin) {
    const requested = typeof req.query.facultyId === 'string' && req.query.facultyId !== 'all' ? req.query.facultyId : null;
    return { facultyId: requested };
  }
  if (!scope.facultyId) throw new AppError(403, 'Konto dziekanatu nie ma przypisanego wydzialu');
  return { facultyId: scope.facultyId };
}

const STATUSES: ChangeRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'];

export const list = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const status = STATUSES.find((s) => s === req.query.status);
  res.json({ data: await listRequests(term, await listScope(req), status) });
});

export const makeups = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  res.json({ data: await listMakeups(term, await listScope(req)) });
});

export const options = asyncHandler(async (req, res) => {
  const user = await caller(req);
  if (!user.instructorId) throw new AppError(403, 'Konto nie jest powiazane z prowadzacym');
  res.json({ data: await requestOptions(String(req.params.id), user.instructorId) });
});

export const create = asyncHandler(async (req, res) => {
  const user = await caller(req);
  const data = await createRequest(String(req.params.id), user, req.body as RequestInput);
  res.status(201).json({ data, message: 'Zgloszenie wyslane do dziekanatu' });
});

async function loadRequest(id: string) {
  const request = await prisma.changeRequest.findUnique({ where: { id } });
  if (!request) throw new AppError(404, 'Zgloszenie nie znalezione');
  return request;
}

export const approve = asyncHandler(async (req, res) => {
  const request = await loadRequest(String(req.params.id));
  await assertFacultyScope(req, request.facultyId);
  const body = req.body as { note?: string } & DecisionOverride;
  const data = await approveRequest(request, req.user!.id, body.note?.trim() || null, body);
  res.json({ data, message: 'Zgloszenie zatwierdzone — zmiana wprowadzona, prowadzacy dostal powiadomienie' });
});

export const reject = asyncHandler(async (req, res) => {
  const request = await loadRequest(String(req.params.id));
  await assertFacultyScope(req, request.facultyId);
  const data = await rejectRequest(request, req.user!.id, String((req.body as { note?: string }).note ?? ''));
  res.json({ data, message: 'Zgloszenie odrzucone — prowadzacy dostal powiadomienie' });
});

export const withdraw = asyncHandler(async (req, res) => {
  const request = await loadRequest(String(req.params.id));
  const data = await withdrawRequest(request, await caller(req));
  res.json({ data, message: 'Zgloszenie wycofane' });
});
