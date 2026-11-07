-- Etap 2 nowego modelu: programy studiow (Program -> ProgramVersion -> ProgramEntry).
--
-- Stare siatki byly kopiowane co rok (3 identyczne kopie) i osobno per specjalnosc.
-- Tu kazda para (kierunek, poziom, tryb) dostaje JEDEN program z JEDNA wersja:
-- przedmioty identyczne we wszystkich specjalnosciach kierunku -> wspolne (specjalnosc
-- null), reszta -> specjalnosciowe. Kazda stara pozycja dostaje wskazanie na nowa
-- (CurriculumEntry.programEntryId) — stary planer dziala dalej do etapu 5.

-- CreateEnum
CREATE TYPE "ProgramVersionStatus" AS ENUM ('DRAFT', 'APPROVED');

-- AlterTable
ALTER TABLE "CurriculumEntry" ADD COLUMN     "programEntryId" TEXT;

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fieldOfStudyId" TEXT NOT NULL,
    "degreeLevel" "DegreeLevel" NOT NULL,
    "studyMode" "StudyMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramVersion" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ProgramVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "totalSemesters" INTEGER NOT NULL,
    "defaultStartType" "SemesterType" NOT NULL DEFAULT 'WINTER',
    "clonedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramEntry" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "specializationId" TEXT,
    "orderInSemester" INTEGER NOT NULL,
    "hoursLecture" INTEGER NOT NULL DEFAULT 0,
    "hoursExercise" INTEGER NOT NULL DEFAULT 0,
    "hoursLab" INTEGER NOT NULL DEFAULT 0,
    "hoursProject" INTEGER NOT NULL DEFAULT 0,
    "hoursSeminar" INTEGER NOT NULL DEFAULT 0,
    "ects" INTEGER NOT NULL DEFAULT 0,
    "assessmentType" "AssessmentType" NOT NULL DEFAULT 'CREDIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Program_code_key" ON "Program"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramVersion_programId_label_key" ON "ProgramVersion"("programId", "label");

-- CreateIndex
CREATE INDEX "ProgramEntry_versionId_semester_idx" ON "ProgramEntry"("versionId", "semester");

-- AddForeignKey
ALTER TABLE "CurriculumEntry" ADD CONSTRAINT "CurriculumEntry_programEntryId_fkey" FOREIGN KEY ("programEntryId") REFERENCES "ProgramEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_fieldOfStudyId_fkey" FOREIGN KEY ("fieldOfStudyId") REFERENCES "FieldOfStudy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramVersion" ADD CONSTRAINT "ProgramVersion_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramVersion" ADD CONSTRAINT "ProgramVersion_clonedFromId_fkey" FOREIGN KEY ("clonedFromId") REFERENCES "ProgramVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramEntry" ADD CONSTRAINT "ProgramEntry_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProgramVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramEntry" ADD CONSTRAINT "ProgramEntry_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramEntry" ADD CONSTRAINT "ProgramEntry_specializationId_fkey" FOREIGN KEY ("specializationId") REFERENCES "Specialization"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Unikalnosc pozycji z NULLS NOT DISTINCT (wspolna pozycja = specjalnosc null).
CREATE UNIQUE INDEX "ProgramEntry_versionId_subjectId_semester_specializationId_key"
  ON "ProgramEntry"("versionId", "subjectId", "semester", "specializationId") NULLS NOT DISTINCT;

-- ─── Bramka: kopie roczne musza byc identyczne ───
DO $$
DECLARE rozne INT;
BEGIN
  SELECT count(*) INTO rozne FROM (
    SELECT cv."specializationId", cv."studyMode"
    FROM "CurriculumVersion" cv
    JOIN LATERAL (
      SELECT md5(string_agg(concat_ws('|', ce."subjectId", ce.semester, ce."hoursLecture", ce."hoursExercise",
               ce."hoursLab", ce."hoursProject", ce."hoursSeminar", ce.ects, ce."assessmentType"), ','
               ORDER BY ce.semester, ce."subjectId")) AS h
      FROM "CurriculumEntry" ce WHERE ce."curriculumVersionId" = cv.id
    ) x ON true
    GROUP BY 1, 2 HAVING count(DISTINCT x.h) > 1
  ) d;
  IF rozne > 0 THEN
    RAISE EXCEPTION 'Siatki % par (specjalnosc, tryb) roznia sie miedzy latami — scalanie wymaga recznej decyzji', rozne;
  END IF;
END $$;

-- ─── Programy: po jednym na (kierunek, poziom, tryb) ───
INSERT INTO "Program" ("id", "code", "name", "fieldOfStudyId", "degreeLevel", "studyMode")
SELECT gen_random_uuid()::text,
       f."shortName" || '-' || CASE p."studyMode" WHEN 'FULL_TIME' THEN 'S' ELSE 'N' END
                     || CASE p."degreeLevel" WHEN 'BACHELOR' THEN '1' ELSE '2' END,
       f.name || ' (' || CASE p."studyMode" WHEN 'FULL_TIME' THEN 'stacjonarne' ELSE 'niestacjonarne' END
              || ', ' || CASE p."degreeLevel" WHEN 'BACHELOR' THEN 'I stopnia' ELSE 'II stopnia' END || ')',
       f.id, p."degreeLevel", p."studyMode"
FROM (SELECT DISTINCT s."fieldOfStudyId", cv."studyMode", cv."degreeLevel"
      FROM "CurriculumVersion" cv JOIN "Specialization" s ON s.id = cv."specializationId") p
JOIN "FieldOfStudy" f ON f.id = p."fieldOfStudyId";

-- ─── Wersja: jedna na program (wszystkie roczniki korzystaja z tej samej) ───
INSERT INTO "ProgramVersion" ("id", "programId", "label", "status", "totalSemesters", "defaultStartType", "updatedAt")
SELECT gen_random_uuid()::text, pr.id, 'Wersja 1', 'APPROVED',
       max(cv."totalSemesters"), min(cv."startSemesterType"::text)::"SemesterType", now()
FROM "Program" pr
JOIN "Specialization" s ON s."fieldOfStudyId" = pr."fieldOfStudyId"
JOIN "CurriculumVersion" cv ON cv."specializationId" = s.id
 AND cv."studyMode" = pr."studyMode" AND cv."degreeLevel" = pr."degreeLevel"
GROUP BY pr.id;

-- ─── Zrodlo: po jednej (najnowszej) kopii siatki kazdej specjalnosci ───
CREATE TEMP TABLE src AS
SELECT pv.id AS version_id, cv."specializationId" AS spec_id, ce."subjectId" AS subject_id, ce.semester,
       ce."orderInSemester" AS ord, ce."hoursLecture" AS hw, ce."hoursExercise" AS hc, ce."hoursLab" AS hl,
       ce."hoursProject" AS hp, ce."hoursSeminar" AS hs, ce.ects, ce."assessmentType" AS assess
FROM "CurriculumVersion" cv
JOIN "CurriculumEntry" ce ON ce."curriculumVersionId" = cv.id
JOIN "Specialization" s ON s.id = cv."specializationId"
JOIN "Program" pr ON pr."fieldOfStudyId" = s."fieldOfStudyId" AND pr."studyMode" = cv."studyMode" AND pr."degreeLevel" = cv."degreeLevel"
JOIN "ProgramVersion" pv ON pv."programId" = pr.id
WHERE cv."academicYear" = (SELECT max(c2."academicYear") FROM "CurriculumVersion" c2
                           WHERE c2."specializationId" = cv."specializationId" AND c2."studyMode" = cv."studyMode");

-- Liczba specjalnosci w programie: przedmiot jest wspolny tylko, gdy specjalnosci sa co
-- najmniej dwie i kazda ma go identycznie (jedyna specjalnosc zostaje oznaczona wprost).
CREATE TEMP TABLE nspec AS SELECT version_id, count(DISTINCT spec_id) AS n FROM src GROUP BY 1;

CREATE TEMP TABLE common AS
SELECT s.version_id, s.subject_id, s.semester, min(s.ord) AS ord, s.hw, s.hc, s.hl, s.hp, s.hs, s.ects, s.assess
FROM src s JOIN nspec n ON n.version_id = s.version_id
WHERE n.n >= 2
GROUP BY s.version_id, s.subject_id, s.semester, s.hw, s.hc, s.hl, s.hp, s.hs, s.ects, s.assess, n.n
HAVING count(DISTINCT s.spec_id) = n.n;

INSERT INTO "ProgramEntry" ("id", "versionId", "subjectId", "semester", "specializationId", "orderInSemester",
  "hoursLecture", "hoursExercise", "hoursLab", "hoursProject", "hoursSeminar", "ects", "assessmentType", "updatedAt")
SELECT gen_random_uuid()::text, version_id, subject_id, semester, NULL, ord, hw, hc, hl, hp, hs, ects, assess, now()
FROM common;

INSERT INTO "ProgramEntry" ("id", "versionId", "subjectId", "semester", "specializationId", "orderInSemester",
  "hoursLecture", "hoursExercise", "hoursLab", "hoursProject", "hoursSeminar", "ects", "assessmentType", "updatedAt")
SELECT gen_random_uuid()::text, s.version_id, s.subject_id, s.semester, s.spec_id, s.ord, s.hw, s.hc, s.hl, s.hp, s.hs, s.ects, s.assess, now()
FROM src s
WHERE NOT EXISTS (SELECT 1 FROM common c WHERE c.version_id = s.version_id AND c.subject_id = s.subject_id AND c.semester = s.semester);

-- ─── Mapowanie starych pozycji (wszystkie lata) na nowe ───
UPDATE "CurriculumEntry" ce
SET "programEntryId" = pe.id
FROM "CurriculumVersion" cv
JOIN "Specialization" s ON s.id = cv."specializationId"
JOIN "Program" pr ON pr."fieldOfStudyId" = s."fieldOfStudyId" AND pr."studyMode" = cv."studyMode" AND pr."degreeLevel" = cv."degreeLevel"
JOIN "ProgramVersion" pv ON pv."programId" = pr.id
JOIN "ProgramEntry" pe ON pe."versionId" = pv.id
WHERE ce."curriculumVersionId" = cv.id
  AND pe."subjectId" = ce."subjectId" AND pe.semester = ce.semester
  AND (pe."specializationId" = cv."specializationId" OR pe."specializationId" IS NULL)
  AND pe."hoursLecture" = ce."hoursLecture" AND pe."hoursExercise" = ce."hoursExercise" AND pe."hoursLab" = ce."hoursLab"
  AND pe."hoursProject" = ce."hoursProject" AND pe."hoursSeminar" = ce."hoursSeminar"
  AND pe.ects = ce.ects AND pe."assessmentType" = ce."assessmentType";

DO $$
DECLARE braki INT;
BEGIN
  SELECT count(*) INTO braki FROM "CurriculumEntry" WHERE "programEntryId" IS NULL;
  IF braki > 0 THEN
    RAISE EXCEPTION 'Mapowanie siatek niekompletne: % pozycji bez odpowiednika w programie', braki;
  END IF;
END $$;

DROP TABLE src;
DROP TABLE nspec;
DROP TABLE common;
