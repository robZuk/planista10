import type { AcademicTerm, ChangeRequest, ChangeRequestStatus, ClassType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { fromIsoDate, toIsoDate, todayIso } from '../lib/isoDate';
import { termKey } from '../lib/terms';
import { dayWindowProblem, formatMinutes } from '../lib/timeGrid';
import { singleConflictMessage } from '../lib/conflictMessage';
import { occurrenceKey, parseOccurrenceKey } from '../lib/occurrenceKey';
import { classLabel, KIND_LABEL, proposalDateProblem, requestableKinds, slotLabel, validateRequestInput, type RequestInput } from '../lib/changeRequests';
import { TeachingCalendar, WEEKDAY_ENUM } from '../lib/teachingCalendar';
import { toCalendarInput } from './termCalendars';
import { activeCohorts } from './sections';
import { calendarFor } from './plan';
import { gridFor } from './timeGrids';
import {
  assertPlanEditable,
  cancelOccurrence,
  createManualOccurrence,
  minutesOf,
  moveOccurrence,
  occurrenceConflicts,
  type OccurrenceFull,
} from './occurrenceChanges';
import { facultyPlannerIds, instructorUserIds, notify } from './notifications';

/**
 * Zgloszenia zmian prowadzacych. Prowadzacy prosi o odwolanie / przeniesienie swojego terminu
 * albo proponuje termin odrobienia odwolanych zajec; dziekanat zatwierdza (zmiana wykonuje sie
 * tymi samymi funkcjami co reczna zmiana planisty, z kontrola kolizji) albo odrzuca. Obie strony
 * dostaja powiadomienia. Reguly: lib/changeRequests; klucz terminu: lib/occurrenceKey.
 */

const CLASS_PL: Record<ClassType, string> = {
  LECTURE: 'wyklad',
  EXERCISE: 'cwiczenia',
  LAB: 'laboratorium',
  PROJECT: 'projekt',
  SEMINAR: 'seminarium',
};

const occurrenceInclude = { placement: true, section: true } satisfies Prisma.OccurrenceInclude;

/** Termin wg trwalego klucza (terminy z wzorca maja nowe id po kazdym generowaniu). */
export async function findByKey(key: string): Promise<OccurrenceFull | null> {
  const parsed = parseOccurrenceKey(key);
  if (!parsed) return null;
  if ('occurrenceId' in parsed) return prisma.occurrence.findUnique({ where: { id: parsed.occurrenceId }, include: occurrenceInclude });
  return prisma.occurrence.findFirst({
    where: { placementId: parsed.placementId, originalDate: fromIsoDate(parsed.originalDate), kind: 'DERIVED' },
    include: occurrenceInclude,
  });
}

export const keyOf = (o: OccurrenceFull) =>
  occurrenceKey({ id: o.id, kind: o.kind, placementId: o.placementId, originalDate: o.originalDate ? toIsoDate(o.originalDate) : null });

/** Przedmiot, forma i nazwa grupy terminu — do opisow i powiadomien. */
async function describe(occ: OccurrenceFull, term: AcademicTerm) {
  const section = await prisma.classSection.findUniqueOrThrow({
    where: { id: occ.sectionId },
    select: { classType: true, cohortId: true, programEntry: { select: { subject: { select: { name: true } } } } },
  });
  const [ctx] = await activeCohorts(term, null, [section.cohortId]);
  return {
    subject: section.programEntry.subject.name,
    classLabel: CLASS_PL[section.classType],
    group: ctx?.nameOf(occ.groupId) ?? '',
  };
}

/** Kalendarz rocznika musi byc opublikowany — prowadzacy widzi i zglasza tylko plan opublikowany. */
async function assertPublished(term: AcademicTerm, cohortId: string) {
  const [ctx] = await activeCohorts(term, null, [cohortId]);
  const calendar = ctx ? await calendarFor(term, ctx) : null;
  if (calendar?.status !== 'PUBLISHED') throw new AppError(409, 'Plan tych zajec nie jest opublikowany (albo jest w archiwum) — zgloszenia sa niedostepne');
  return ctx!;
}

/** Czy odwolany termin ma juz odrobienie (termin reczny wskazujacy jego klucz). */
async function isMadeUp(key: string): Promise<boolean> {
  return (await prisma.occurrence.count({ where: { makeupOfKey: key, status: { not: 'CANCELLED' } } })) > 0;
}

async function hasPending(key: string): Promise<boolean> {
  return (await prisma.changeRequest.count({ where: { occurrenceKey: key, status: 'PENDING' } })) > 0;
}

/** Co prowadzacy moze zglosic dla swojego terminu + siatka godzin do formularza propozycji. */
export async function requestOptions(occurrenceId: string, instructorId: string) {
  const occ = await prisma.occurrence.findUnique({ where: { id: occurrenceId }, include: occurrenceInclude });
  if (!occ || occ.instructorId !== instructorId) throw new AppError(404, 'Termin nie znaleziony wsrod Twoich zajec');
  const key = keyOf(occ);
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: occ.termId } });
  const ctx = await assertPublished(term, occ.section.cohortId);
  const grid = await gridFor(occ.facultyId, ctx.cohort.program.studyMode);
  const allowed = requestableKinds({
    status: occ.status,
    date: toIsoDate(occ.date),
    today: todayIso(),
    pending: await hasPending(key),
    madeUp: occ.status === 'CANCELLED' ? await isMadeUp(key) : false,
  });
  return {
    ...allowed,
    occurrence: {
      id: occ.id,
      date: toIsoDate(occ.date),
      startOrder: occ.startOrder,
      endOrder: occ.endOrder,
      roomId: occ.roomId,
      status: occ.status,
      ...(await describe(occ, term)),
    },
    blocks: grid.blocks.map((b) => ({ order: b.order, startTime: b.startTime, endTime: b.endTime })),
    days: grid.days.map((d) => d.day),
  };
}

/** Zgloszenie prowadzacego. Propozycja (MOVE/MAKEUP) jest sprawdzana na kolizje juz teraz. */
export async function createRequest(occurrenceId: string, user: { id: string; instructorId: string | null }, input: RequestInput) {
  if (!user.instructorId) throw new AppError(403, 'Konto nie jest powiazane z prowadzacym');
  const occ = await prisma.occurrence.findUnique({ where: { id: occurrenceId }, include: occurrenceInclude });
  if (!occ || occ.instructorId !== user.instructorId) throw new AppError(404, 'Termin nie znaleziony wsrod Twoich zajec');
  const key = keyOf(occ);
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: occ.termId } });
  const ctx = await assertPublished(term, occ.section.cohortId);
  const today = todayIso();

  const allowed = requestableKinds({
    status: occ.status,
    date: toIsoDate(occ.date),
    today,
    pending: await hasPending(key),
    madeUp: occ.status === 'CANCELLED' ? await isMadeUp(key) : false,
  });
  if (!allowed.kinds.includes(input.kind)) {
    throw new AppError(409, allowed.reason ?? `Dla tego terminu nie mozna zglosic: ${KIND_LABEL[input.kind]}`);
  }
  const problems = validateRequestInput(input, today);
  if (problems.length > 0) throw new AppError(400, problems.join('; '));

  if (input.kind !== 'CANCEL') {
    const grid = await gridFor(occ.facultyId, ctx.cohort.program.studyMode);
    const time = minutesOf(grid.time, input.startOrder!, input.endOrder!);
    // Dzien zajec rocznika (semestr, swieta, przerwy, zjazdy) i dzien/okno godzin wydzialu.
    const calendar = await calendarFor(term, ctx);
    const dateProblem = proposalDateProblem(new TeachingCalendar(toCalendarInput(calendar!)).dayInfo(input.date!));
    if (dateProblem) throw new AppError(400, dateProblem);
    const weekday = WEEKDAY_ENUM[new Date(`${input.date!}T12:00:00Z`).getUTCDay()]!;
    const windowProblem = dayWindowProblem(grid.days, weekday, time.startMinute, time.endMinute);
    if (windowProblem) throw new AppError(400, windowProblem);
    const roomId = input.online ? null : (input.roomId ?? null);
    if (roomId && !(await prisma.room.findUnique({ where: { id: roomId } }))) throw new AppError(400, 'Sala nie istnieje');
    const derived = occ.kind === 'DERIVED' && occ.placementId && occ.originalDate;
    const conflict = await occurrenceConflicts(
      term,
      { date: input.date!, ...time, roomId, instructorId: occ.instructorId, groupId: occ.groupId, jointKey: input.kind === 'MOVE' ? occ.jointKey : null },
      input.kind === 'MOVE'
        ? derived
          ? { excludePatternKey: `${occ.placementId}|${toIsoDate(occ.originalDate!)}`, excludeOccurrenceId: occ.id }
          : { excludeOccurrenceId: occ.id }
        : {},
    );
    if (conflict) throw new AppError(409, `Proponowany termin koliduje: ${singleConflictMessage(conflict)}`);
  }

  const request = await prisma.changeRequest.create({
    data: {
      termId: occ.termId,
      facultyId: occ.facultyId,
      sectionId: occ.sectionId,
      instructorId: user.instructorId,
      requestedById: user.id,
      kind: input.kind,
      occurrenceKey: key,
      originalDate: occ.date,
      originalStartMinute: occ.startMinute,
      originalEndMinute: occ.endMinute,
      newDate: input.kind === 'CANCEL' ? null : fromIsoDate(input.date!),
      newStartOrder: input.kind === 'CANCEL' ? null : input.startOrder!,
      newEndOrder: input.kind === 'CANCEL' ? null : input.endOrder!,
      newRoomId: input.kind === 'CANCEL' || input.online ? null : (input.roomId ?? null),
      newOnline: input.kind !== 'CANCEL' && !!input.online,
      reason: input.reason!.trim(),
    },
  });

  const info = await describe(occ, term);
  const instructor = await prisma.instructor.findUniqueOrThrow({ where: { id: user.instructorId } });
  const who = `${instructor.title ?? ''} ${instructor.firstName} ${instructor.lastName}`.trim();
  await notify(await facultyPlannerIds(occ.facultyId), {
    kind: 'REQUEST_CREATED',
    title: `Zgloszenie: ${KIND_LABEL[input.kind]}`,
    body: `${who}: ${classLabel({ ...info, date: toIsoDate(occ.date), startMinute: occ.startMinute, endMinute: occ.endMinute })}. Powod: ${request.reason}`,
    link: `/requests/${termKey(term)}`,
    requestId: request.id,
  });
  return request;
}

export interface DecisionOverride {
  date?: string;
  startOrder?: number;
  endOrder?: number;
  roomId?: string | null;
  online?: boolean;
}

/** Zatwierdzenie: wykonuje zmiane (dziekanat moze poprawic propozycje: date, godziny, sale). */
export async function approveRequest(request: ChangeRequest, actorId: string, note: string | null, override: DecisionOverride = {}) {
  if (request.status !== 'PENDING') throw new AppError(409, 'Zgloszenie zostalo juz rozpatrzone');
  const occ = await findByKey(request.occurrenceKey);
  if (!occ) throw new AppError(409, 'Tego terminu juz nie ma w planie (plan wygenerowano od nowa) — odrzuc zgloszenie z wyjasnieniem');
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: request.termId } });
  const grid = await assertPlanEditable(request.termId, occ.section.cohortId);

  const final = {
    date: override.date ?? (request.newDate ? toIsoDate(request.newDate) : undefined),
    startOrder: override.startOrder ?? request.newStartOrder ?? undefined,
    endOrder: override.endOrder ?? request.newEndOrder ?? undefined,
    online: override.online ?? request.newOnline,
    roomId: override.roomId !== undefined ? override.roomId : request.newRoomId,
  };
  const info = await describe(occ, term);
  const original = slotLabel(toIsoDate(occ.date), occ.startMinute, occ.endMinute);
  let outcome: string;

  if (request.kind === 'CANCEL') {
    if (occ.status === 'CANCELLED') throw new AppError(409, 'Termin jest juz odwolany');
    await cancelOccurrence(occ, `Odwolane na prosbe prowadzacego: ${request.reason}`);
    outcome = `Zajecia ${original} sa odwolane — pojawily sie na Twojej liscie do odrobienia.`;
  } else if (request.kind === 'MOVE') {
    await moveOccurrence(occ, grid, { ...final, note: `Przeniesione na prosbe prowadzacego: ${request.reason}` });
    const moved = await prisma.occurrence.findUniqueOrThrow({ where: { id: occ.id } });
    outcome = `Zajecia ${original} przeniesione na ${slotLabel(toIsoDate(moved.date), moved.startMinute, moved.endMinute)}.`;
  } else {
    if (occ.status !== 'CANCELLED') throw new AppError(409, 'Odrabiac mozna tylko odwolane zajecia');
    if (await isMadeUp(request.occurrenceKey)) throw new AppError(409, 'Te zajecia maja juz termin odrobienia');
    const section = await prisma.classSection.findUniqueOrThrow({ where: { id: occ.sectionId } });
    const made = await createManualOccurrence(term, section, grid, {
      date: final.date!,
      startOrder: final.startOrder!,
      endOrder: final.endOrder!,
      roomId: final.roomId,
      online: final.online,
      instructorId: request.instructorId,
      note: `Odrobienie zajec z ${original}`,
      makeupOfKey: request.occurrenceKey,
    });
    outcome = `Odrobienie zajec z ${original}: ${slotLabel(toIsoDate(made.date), made.startMinute, made.endMinute)}.`;
  }

  const updated = await prisma.changeRequest.update({
    where: { id: request.id },
    data: {
      status: 'APPROVED',
      decidedById: actorId,
      decidedAt: new Date(),
      decisionNote: note,
      // Zapisujemy ostateczna propozycje (dziekanat mogl ja poprawic).
      ...(request.kind !== 'CANCEL' && final.date
        ? { newDate: fromIsoDate(final.date), newStartOrder: final.startOrder, newEndOrder: final.endOrder, newRoomId: final.online ? null : final.roomId, newOnline: !!final.online }
        : {}),
    },
  });
  await notify(
    await instructorUserIds(request.instructorId),
    {
      kind: 'REQUEST_APPROVED',
      title: `Zatwierdzono: ${KIND_LABEL[request.kind]}`,
      body: `${info.subject} (${info.classLabel}), ${info.group}. ${outcome}${note ? ` Dziekanat: ${note}` : ''}`,
      link: `/requests/${termKey(term)}`,
      requestId: request.id,
    },
    actorId,
  );
  return updated;
}

export async function rejectRequest(request: ChangeRequest, actorId: string, note: string) {
  if (request.status !== 'PENDING') throw new AppError(409, 'Zgloszenie zostalo juz rozpatrzone');
  if (!note || note.trim().length < 3) throw new AppError(400, 'Napisz prowadzacemu, dlaczego zgloszenie jest odrzucone');
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: request.termId } });
  const updated = await prisma.changeRequest.update({
    where: { id: request.id },
    data: { status: 'REJECTED', decidedById: actorId, decidedAt: new Date(), decisionNote: note.trim() },
  });
  const subject = await subjectOf(request.sectionId);
  await notify(
    await instructorUserIds(request.instructorId),
    {
      kind: 'REQUEST_REJECTED',
      title: `Odrzucono: ${KIND_LABEL[request.kind]}`,
      body: `${subject}, ${slotLabel(toIsoDate(request.originalDate), request.originalStartMinute, request.originalEndMinute)}. Dziekanat: ${note.trim()}`,
      link: `/requests/${termKey(term)}`,
      requestId: request.id,
    },
    actorId,
  );
  return updated;
}

export async function withdrawRequest(request: ChangeRequest, user: { id: string; instructorId: string | null }) {
  if (request.instructorId !== user.instructorId) throw new AppError(403, 'To nie jest Twoje zgloszenie');
  if (request.status !== 'PENDING') throw new AppError(409, 'Rozpatrzonego zgloszenia nie mozna wycofac');
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: request.termId } });
  const updated = await prisma.changeRequest.update({ where: { id: request.id }, data: { status: 'WITHDRAWN' } });
  const subject = await subjectOf(request.sectionId);
  await notify(
    await facultyPlannerIds(request.facultyId),
    {
      kind: 'REQUEST_WITHDRAWN',
      title: `Wycofano zgloszenie: ${KIND_LABEL[request.kind]}`,
      body: `${subject}, ${slotLabel(toIsoDate(request.originalDate), request.originalStartMinute, request.originalEndMinute)}`,
      link: `/requests/${termKey(term)}`,
      requestId: request.id,
    },
    user.id,
  );
  return updated;
}

async function subjectOf(sectionId: string): Promise<string> {
  const s = await prisma.classSection.findUniqueOrThrow({
    where: { id: sectionId },
    select: { classType: true, programEntry: { select: { subject: { select: { name: true } } } } },
  });
  return `${s.programEntry.subject.name} (${CLASS_PL[s.classType]})`;
}

const personName = (p: { title: string | null; firstName: string; lastName: string } | null) =>
  p ? `${p.title ?? ''} ${p.firstName} ${p.lastName}`.trim() : '';

/** Lista zgloszen semestru: prowadzacy — swoje; dziekanat — wydzialu; admin — wybranego wydzialu albo wszystkie. */
export async function listRequests(term: AcademicTerm, scope: { instructorId?: string; facultyId?: string | null }, status?: ChangeRequestStatus) {
  const rows = await prisma.changeRequest.findMany({
    where: {
      termId: term.id,
      ...(scope.instructorId ? { instructorId: scope.instructorId } : {}),
      ...(scope.facultyId ? { facultyId: scope.facultyId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      instructor: { select: { title: true, firstName: true, lastName: true } },
      decidedBy: { select: { name: true } },
      newRoom: { select: { number: true, building: { select: { name: true } } } },
      section: { select: { classType: true, cohortId: true, groupId: true, programEntry: { select: { subject: { select: { name: true } } } }, cohort: { select: { program: { select: { code: true } } } } } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
  const contexts = await activeCohorts(term, null, [...new Set(rows.map((r) => r.section.cohortId))].filter(Boolean));
  const nameOf = new Map(contexts.map((c) => [c.cohort.id, c.nameOf]));
  // Bloki -> godziny propozycji wg siatki wydzialu i trybu rocznika.
  const blocksCache = new Map<string, Map<number, { startTime: string; endTime: string }>>();
  const blocksFor = async (facultyId: string, cohortId: string) => {
    const mode = contexts.find((c) => c.cohort.id === cohortId)?.cohort.program.studyMode;
    if (!mode) return null;
    const k = `${facultyId}|${mode}`;
    if (!blocksCache.has(k)) blocksCache.set(k, new Map((await gridFor(facultyId, mode)).blocks.map((b) => [b.order, b])));
    return blocksCache.get(k)!;
  };
  return Promise.all(
    rows.map(async (r) => {
      const blocks = r.newStartOrder !== null ? await blocksFor(r.facultyId, r.section.cohortId) : null;
      const occ = r.status === 'PENDING' ? await findByKey(r.occurrenceKey) : null;
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        instructor: personName(r.instructor),
        subject: r.section.programEntry.subject.name,
        classType: r.section.classType,
        program: r.section.cohort.program.code,
        group: nameOf.get(r.section.cohortId)?.(r.section.groupId) ?? '',
        original: { date: toIsoDate(r.originalDate), time: `${formatMinutes(r.originalStartMinute)}–${formatMinutes(r.originalEndMinute)}` },
        proposal:
          r.kind === 'CANCEL'
            ? null
            : {
                date: r.newDate ? toIsoDate(r.newDate) : null,
                startOrder: r.newStartOrder,
                endOrder: r.newEndOrder,
                time: blocks && r.newStartOrder !== null && r.newEndOrder !== null
                  ? `${blocks.get(r.newStartOrder)?.startTime ?? '?'}–${blocks.get(r.newEndOrder)?.endTime ?? '?'}`
                  : null,
                roomId: r.newRoomId,
                room: r.newOnline ? 'ON-LINE' : r.newRoom ? `${r.newRoom.number} (${r.newRoom.building.name})` : null,
                online: r.newOnline,
              },
        reason: r.reason,
        decisionNote: r.decisionNote,
        decidedBy: r.decidedBy?.name ?? null,
        decidedAt: r.decidedAt,
        createdAt: r.createdAt,
        // Zgloszenie czekajace, ktorego terminu juz nie ma (plan wygenerowano od nowa).
        stale: r.status === 'PENDING' && !occ,
      };
    }),
  );
}

/**
 * Zajecia odwolane do odrobienia: odwolane terminy prowadzacego (albo wydzialu) i ich stan —
 * odrobione (jest termin reczny z ich kluczem), zgloszony termin odrobienia, albo nic.
 */
export async function listMakeups(term: AcademicTerm, scope: { instructorId?: string; facultyId?: string | null }) {
  const cancelled = await prisma.occurrence.findMany({
    where: {
      termId: term.id,
      status: 'CANCELLED',
      ...(scope.instructorId ? { instructorId: scope.instructorId } : { instructorId: { not: null } }),
      ...(scope.facultyId ? { facultyId: scope.facultyId } : {}),
    },
    include: {
      ...occurrenceInclude,
      instructor: { select: { title: true, firstName: true, lastName: true } },
      section: { select: { id: true, classType: true, cohortId: true, programEntry: { select: { subject: { select: { name: true } } } }, cohort: { select: { program: { select: { code: true } } } } } },
    },
    orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
  });
  const keys = cancelled.map((o) =>
    occurrenceKey({ id: o.id, kind: o.kind, placementId: o.placementId, originalDate: o.originalDate ? toIsoDate(o.originalDate) : null }),
  );
  const [makeups, pending] = await Promise.all([
    prisma.occurrence.findMany({ where: { makeupOfKey: { in: keys }, status: { not: 'CANCELLED' } } }),
    prisma.changeRequest.findMany({ where: { occurrenceKey: { in: keys }, kind: 'MAKEUP', status: 'PENDING' } }),
  ]);
  const madeUp = new Map(makeups.map((m) => [m.makeupOfKey!, m]));
  const pendingByKey = new Map(pending.map((p) => [p.occurrenceKey, p]));
  const contexts = await activeCohorts(term, null, [...new Set(cancelled.map((o) => o.section.cohortId))].filter(Boolean));
  const nameOf = new Map(contexts.map((c) => [c.cohort.id, c.nameOf]));
  return cancelled.map((o, i) => {
    const m = madeUp.get(keys[i]!);
    const p = pendingByKey.get(keys[i]!);
    return {
      occurrenceId: o.id,
      key: keys[i]!,
      date: toIsoDate(o.date),
      time: `${formatMinutes(o.startMinute)}–${formatMinutes(o.endMinute)}`,
      subject: o.section.programEntry.subject.name,
      classType: o.section.classType,
      program: o.section.cohort.program.code,
      group: nameOf.get(o.section.cohortId)?.(o.groupId) ?? '',
      instructor: personName(o.instructor),
      hours: o.endOrder - o.startOrder + 1,
      note: o.note,
      state: m ? 'MADE_UP' : p ? 'REQUESTED' : 'TODO',
      makeup: m ? { date: toIsoDate(m.date), time: `${formatMinutes(m.startMinute)}–${formatMinutes(m.endMinute)}` } : null,
    };
  });
}

/**
 * Dziekanat zmienil termin prowadzacego wprost (Ukladanie planu → Terminy): powiadomienie dla
 * prowadzacego — tylko gdy plan rocznika jest opublikowany (zmiany w przygotowaniu to szum).
 * Bledy powiadomienia nie cofaja zmiany terminu.
 */
export async function notifyClassChange(
  occurrenceId: string,
  kind: 'CLASS_CANCELLED' | 'CLASS_CHANGED' | 'MAKEUP_SCHEDULED',
  actorId: string,
  before?: { date: Date; startMinute: number; endMinute: number },
): Promise<void> {
  const occ = await prisma.occurrence.findUnique({ where: { id: occurrenceId }, include: occurrenceInclude });
  if (!occ?.instructorId) return;
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: occ.termId } });
  const [ctx] = await activeCohorts(term, null, [occ.section.cohortId]);
  const calendar = ctx ? await calendarFor(term, ctx) : null;
  if (calendar?.status !== 'PUBLISHED') return;
  const info = await describe(occ, term);
  const now = slotLabel(toIsoDate(occ.date), occ.startMinute, occ.endMinute);
  const was = before ? slotLabel(toIsoDate(before.date), before.startMinute, before.endMinute) : now;
  const text = {
    CLASS_CANCELLED: { title: 'Dziekanat odwolal Twoje zajecia', body: `${was} — sa na liscie zajec do odrobienia.` },
    CLASS_CHANGED: { title: 'Dziekanat zmienil termin Twoich zajec', body: was === now ? `Termin: ${now}.` : `Bylo: ${was}, jest: ${now}.` },
    MAKEUP_SCHEDULED: { title: 'Nowy termin Twoich zajec', body: `Dodany termin: ${now}.` },
  }[kind];
  await notify(
    await instructorUserIds(occ.instructorId),
    {
      kind,
      title: text.title,
      body: `${info.subject} (${info.classLabel}), ${info.group}. ${text.body}${occ.note ? ` Uwagi: ${occ.note}` : ''}`,
      link: `/my-plan/${termKey(term)}`,
    },
    actorId,
  );
}
