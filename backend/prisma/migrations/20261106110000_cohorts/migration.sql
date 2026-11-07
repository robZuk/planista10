-- Etap 3 nowego modelu: roczniki (Cohort) i grupy przypiete do rocznika.
--
-- Grupy 2024/25 trafiaja do rocznikow: rok studiow y w roku akademickim Y -> nabor
-- zimowy Y-(y-1). Kazdy rocznik dostaje korzen (ROOT = caly rocznik); dawne grupy
-- wykladowe (W) staja sie podgrupami specjalnosci (SPEC), reszta zachowuje rodzicow.
-- Grupy bez rodzica (np. DUT-7-C-A, gdy semestr 7 nie ma wykladow) dostaja rodzica SPEC.
-- Stare pola (academicYear, studyYear) zostaja — korzysta z nich stary plan do etapu 5.

-- CreateEnum
CREATE TYPE "CohortLectureMode" AS ENUM ('SEPARATE', 'JOINT');


-- AlterTable
ALTER TABLE "StudentGroup" ADD COLUMN     "code" TEXT,
ADD COLUMN     "cohortId" TEXT,
ADD COLUMN     "fromSemester" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "partitionKey" TEXT,
ADD COLUMN     "toSemester" INTEGER,
ALTER COLUMN "studyYear" DROP NOT NULL,
ALTER COLUMN "academicYear" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Cohort" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "programVersionId" TEXT NOT NULL,
    "startTermId" TEXT NOT NULL,
    "name" TEXT,
    "lectureMode" "CohortLectureMode" NOT NULL DEFAULT 'SEPARATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CohortTerm" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "calendarId" TEXT,

    CONSTRAINT "CohortTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cohort_programId_startTermId_key" ON "Cohort"("programId", "startTermId");

-- CreateIndex
CREATE UNIQUE INDEX "CohortTerm_cohortId_termId_key" ON "CohortTerm"("cohortId", "termId");

-- CreateIndex
CREATE INDEX "StudentGroup_cohortId_idx" ON "StudentGroup"("cohortId");

-- AddForeignKey
ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_programVersionId_fkey" FOREIGN KEY ("programVersionId") REFERENCES "ProgramVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_startTermId_fkey" FOREIGN KEY ("startTermId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CohortTerm" ADD CONSTRAINT "CohortTerm_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CohortTerm" ADD CONSTRAINT "CohortTerm_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CohortTerm" ADD CONSTRAINT "CohortTerm_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "TermCalendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Semestry startowe rocznikow (np. 2021 zimowy dla 4. roku w 2024/25) ───
INSERT INTO "AcademicTerm" ("id", "startYear", "type")
SELECT gen_random_uuid()::text, y, 'WINTER'
FROM (SELECT DISTINCT split_part("academicYear", '/', 1)::int - ("studyYear" - 1) AS y
      FROM "StudentGroup" WHERE "academicYear" IS NOT NULL) s
ON CONFLICT ("startYear", "type") DO NOTHING;

-- ─── Mapa: grupa -> program, semestr startowy, rodzaj i kod z nazwy ───
CREATE TEMP TABLE gmap AS
SELECT g.id AS group_id,
       (SELECT pr.id FROM "Program" pr
         WHERE pr."fieldOfStudyId" = g."fieldOfStudyId" AND pr."studyMode" = g."studyMode"
         ORDER BY pr."degreeLevel" LIMIT 1) AS program_id,
       t.id AS start_term_id,
       substring(g.name from '^[A-Z]+(?:-SN)?-\d-(W|C|L|P|S)') AS letter,
       substring(g.name from '^[A-Z]+(?:-SN)?-\d-[WCLPS]-([A-Z]\d*)$') AS code
FROM "StudentGroup" g
JOIN "AcademicTerm" t ON t."type" = 'WINTER'
 AND t."startYear" = split_part(g."academicYear", '/', 1)::int - (g."studyYear" - 1)
WHERE g."academicYear" IS NOT NULL;

DO $$
DECLARE braki INT;
BEGIN
  SELECT count(*) INTO braki FROM gmap WHERE program_id IS NULL OR letter IS NULL;
  IF braki > 0 THEN
    RAISE EXCEPTION 'Grupy bez programu albo z nierozpoznana nazwa: %', braki;
  END IF;
END $$;

-- ─── Roczniki ───
INSERT INTO "Cohort" ("id", "programId", "programVersionId", "startTermId", "lectureMode", "updatedAt")
SELECT gen_random_uuid()::text, m.program_id,
       (SELECT pv.id FROM "ProgramVersion" pv WHERE pv."programId" = m.program_id
         ORDER BY (pv.status = 'APPROVED') DESC, pv."createdAt" DESC LIMIT 1),
       m.start_term_id, 'SEPARATE', now()
FROM (SELECT DISTINCT program_id, start_term_id FROM gmap) m;

UPDATE "StudentGroup" g
SET "cohortId" = c.id,
    "partitionKey" = CASE m.letter WHEN 'W' THEN 'SPEC' ELSE m.letter END,
    "code" = CASE m.letter WHEN 'W' THEN s."shortName" ELSE m.code END,
    "fromSemester" = 1
FROM gmap m
JOIN "Cohort" c ON c."programId" = m.program_id AND c."startTermId" = m.start_term_id
LEFT JOIN "StudentGroup" g2 ON g2.id = m.group_id
LEFT JOIN "Specialization" s ON s.id = g2."specializationId"
WHERE g.id = m.group_id;

-- ─── Korzen kazdego rocznika (caly rocznik) ───
INSERT INTO "StudentGroup" ("id", "name", "fieldOfStudyId", "studyMode", "type", "size", "cohortId",
                            "partitionKey", "fromSemester", "updatedAt")
SELECT gen_random_uuid()::text,
       f."shortName" || '-' || pr.code || '-' || t."startYear" || '-ROOT',
       pr."fieldOfStudyId", pr."studyMode", 'LECTURE',
       COALESCE((SELECT sum(g.size) FROM "StudentGroup" g WHERE g."cohortId" = c.id AND g."partitionKey" = 'SPEC'), 0),
       c.id, 'ROOT', 1, now()
FROM "Cohort" c
JOIN "Program" pr ON pr.id = c."programId"
JOIN "FieldOfStudy" f ON f.id = pr."fieldOfStudyId"
JOIN "AcademicTerm" t ON t.id = c."startTermId";

-- Specjalnosci pod korzeniem.
UPDATE "StudentGroup" g
SET "parentGroupId" = r.id
FROM "StudentGroup" r
WHERE g."partitionKey" = 'SPEC' AND r."partitionKey" = 'ROOT' AND r."cohortId" = g."cohortId";

-- Brakujace grupy SPEC dla grup bez rodzica (np. semestr bez wykladow).
INSERT INTO "StudentGroup" ("id", "name", "fieldOfStudyId", "specializationId", "studyMode", "type", "size",
                            "cohortId", "partitionKey", "code", "fromSemester", "parentGroupId", "updatedAt")
SELECT gen_random_uuid()::text,
       s."shortName" || '-' || c.id || '-SPEC',
       o."fieldOfStudyId", o."specializationId", o."studyMode", 'LECTURE',
       (SELECT sum(x.size) FROM "StudentGroup" x WHERE x."cohortId" = o."cohortId" AND x."specializationId" = o."specializationId"
          AND x."parentGroupId" IS NULL AND x."partitionKey" = 'C'),
       o."cohortId", 'SPEC', s."shortName", 1, r.id, now()
FROM (SELECT DISTINCT "cohortId", "specializationId", "fieldOfStudyId", "studyMode"
      FROM "StudentGroup"
      WHERE "parentGroupId" IS NULL AND "partitionKey" NOT IN ('ROOT', 'SPEC') AND "cohortId" IS NOT NULL) o
JOIN "Cohort" c ON c.id = o."cohortId"
JOIN "Specialization" s ON s.id = o."specializationId"
JOIN "StudentGroup" r ON r."cohortId" = o."cohortId" AND r."partitionKey" = 'ROOT'
WHERE NOT EXISTS (SELECT 1 FROM "StudentGroup" e WHERE e."cohortId" = o."cohortId"
                  AND e."partitionKey" = 'SPEC' AND e."specializationId" = o."specializationId");

UPDATE "StudentGroup" g
SET "parentGroupId" = sp.id
FROM "StudentGroup" sp
WHERE g."parentGroupId" IS NULL AND g."partitionKey" NOT IN ('ROOT', 'SPEC')
  AND sp."cohortId" = g."cohortId" AND sp."partitionKey" = 'SPEC' AND sp."specializationId" = g."specializationId";

-- Liczebnosc korzenia = suma specjalnosci (liczona po dodaniu brakujacych SPEC).
UPDATE "StudentGroup" r
SET size = sub.total
FROM (SELECT "cohortId", sum(size) AS total FROM "StudentGroup" WHERE "partitionKey" = 'SPEC' GROUP BY 1) sub
WHERE r."partitionKey" = 'ROOT' AND r."cohortId" = sub."cohortId";

-- ─── Bramki ───
DO $$
DECLARE bez_rocznika INT; bez_rodzica INT;
BEGIN
  SELECT count(*) INTO bez_rocznika FROM "StudentGroup" WHERE "cohortId" IS NULL;
  SELECT count(*) INTO bez_rodzica FROM "StudentGroup" WHERE "partitionKey" <> 'ROOT' AND "parentGroupId" IS NULL;
  IF bez_rocznika > 0 OR bez_rodzica > 0 THEN
    RAISE EXCEPTION 'Migracja grup niekompletna: % bez rocznika, % bez rodzica', bez_rocznika, bez_rodzica;
  END IF;
END $$;

DROP TABLE gmap;

-- ─── Konto dziekanatu z danych deweloperskich dostaje wydzial (WM), zeby moglo planowac ───
UPDATE "User" SET "facultyId" = (SELECT id FROM "Faculty" WHERE "shortName" = 'WM')
WHERE email = 'dziekanat@umg.edu.pl' AND "facultyId" IS NULL AND role = 'DEAN_OFFICE'
  AND (SELECT count(*) FROM "Faculty" WHERE "shortName" = 'WM') = 1;
