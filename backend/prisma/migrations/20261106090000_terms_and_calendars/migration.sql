-- Etap 1 nowego modelu: semestry (AcademicTerm) i kalendarze semestru (TermCalendar).
--
-- 1. Nowe tabele: AcademicTerm, TermCalendar (+ przerwy, wyjatki dni, zjazdy).
-- 2. Backfill: semestry z istniejacych kalendarzy i siatek + biezacy rok akademicki;
--    kazdy SemesterCalendar staje sie TermCalendar (rytm tygodniowy, bez przerw —
--    tak jak liczyl stary generator, zeby historia odtwarzala sie 1:1).
-- 3. Bramka: liczba kalendarzy musi sie zgadzac.
-- Stare tabele (SemesterCalendar, PublicHoliday) zostaja do etapu 7 — korzysta z nich
-- jeszcze stary generator.

-- ─── 1. Typy i tabele ───
CREATE TYPE "CalendarKind" AS ENUM ('WEEKLY', 'ZJAZD');
CREATE TYPE "CalendarStatus" AS ENUM ('PLANNING', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "CalendarDayKind" AS ENUM ('DAY_OFF', 'FOLLOWS_WEEKDAY', 'CLOSED_FROM');

CREATE TABLE "AcademicTerm" (
    "id" TEXT NOT NULL,
    "startYear" INTEGER NOT NULL,
    "type" "SemesterType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicTerm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TermCalendar" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "studyMode" "StudyMode" NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Podstawowy',
    "kind" "CalendarKind" NOT NULL,
    "status" "CalendarStatus" NOT NULL DEFAULT 'PLANNING',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermCalendar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarBreak" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,

    CONSTRAINT "CalendarBreak_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarDay" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "CalendarDayKind" NOT NULL,
    "name" TEXT,
    "followsWeekday" "DayOfWeek",
    "closedFromBlockOrder" INTEGER,

    CONSTRAINT "CalendarDay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Zjazd" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,

    CONSTRAINT "Zjazd_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcademicTerm_startYear_type_key" ON "AcademicTerm"("startYear", "type");
CREATE INDEX "TermCalendar_facultyId_idx" ON "TermCalendar"("facultyId");
CREATE UNIQUE INDEX "TermCalendar_termId_facultyId_studyMode_name_key" ON "TermCalendar"("termId", "facultyId", "studyMode", "name");
CREATE UNIQUE INDEX "CalendarDay_calendarId_date_key" ON "CalendarDay"("calendarId", "date");
CREATE UNIQUE INDEX "Zjazd_calendarId_number_key" ON "Zjazd"("calendarId", "number");

ALTER TABLE "TermCalendar" ADD CONSTRAINT "TermCalendar_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TermCalendar" ADD CONSTRAINT "TermCalendar_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarBreak" ADD CONSTRAINT "CalendarBreak_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "TermCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarDay" ADD CONSTRAINT "CalendarDay_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "TermCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Zjazd" ADD CONSTRAINT "Zjazd_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "TermCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Wyrownanie dryfu starej tabeli (schemat juz to deklaruje) ───
ALTER TABLE "SemesterCalendar" DROP CONSTRAINT "SemesterCalendar_facultyId_fkey";
ALTER TABLE "SemesterCalendar" ADD CONSTRAINT "SemesterCalendar_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER INDEX "SemesterCalendar_academicYear_semesterType_studyMode_facultyId_" RENAME TO "SemesterCalendar_academicYear_semesterType_studyMode_facult_key";

-- ─── 2. Backfill semestrow ───
-- Lata z kalendarzy (konkretny typ) i z siatek (oba typy), plus biezacy rok akademicki
-- (rok startu = rok kalendarzowy, a przed pazdziernikiem rok poprzedni).
INSERT INTO "AcademicTerm" ("id", "startYear", "type")
SELECT gen_random_uuid()::text, src.y, src.t::"SemesterType"
FROM (
  SELECT split_part("academicYear", '/', 1)::int AS y, "semesterType"::text AS t FROM "SemesterCalendar"
  UNION
  SELECT split_part("academicYear", '/', 1)::int, unnest(ARRAY['WINTER', 'SUMMER']) FROM "CurriculumVersion"
  UNION
  SELECT (EXTRACT(YEAR FROM now()) - CASE WHEN EXTRACT(MONTH FROM now()) < 10 THEN 1 ELSE 0 END)::int,
         unnest(ARRAY['WINTER', 'SUMMER'])
) src
ON CONFLICT ("startYear", "type") DO NOTHING;

-- ─── Backfill kalendarzy ───
-- Kalendarz, ktorego semestr juz sie skonczyl, trafia od razu do archiwum (tylko odczyt).
INSERT INTO "TermCalendar" ("id", "termId", "facultyId", "studyMode", "name", "kind", "status", "startDate", "endDate", "updatedAt")
SELECT gen_random_uuid()::text,
       t."id",
       sc."facultyId",
       sc."studyMode",
       'Podstawowy',
       'WEEKLY',
       (CASE WHEN sc."endDate" < now() THEN 'ARCHIVED' ELSE 'PLANNING' END)::"CalendarStatus",
       sc."startDate"::date,
       sc."endDate"::date,
       now()
FROM "SemesterCalendar" sc
JOIN "AcademicTerm" t
  ON t."startYear" = split_part(sc."academicYear", '/', 1)::int
 AND t."type" = sc."semesterType";

-- ─── 3. Bramka ───
DO $$
DECLARE stare INT; nowe INT;
BEGIN
  SELECT count(*) INTO stare FROM "SemesterCalendar";
  SELECT count(*) INTO nowe FROM "TermCalendar";
  IF stare <> nowe THEN
    RAISE EXCEPTION 'Migracja kalendarzy niekompletna: % starych, % nowych', stare, nowe;
  END IF;
END $$;
