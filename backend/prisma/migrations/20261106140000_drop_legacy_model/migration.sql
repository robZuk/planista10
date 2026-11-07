-- Etap 7: usuniecie starego modelu planowania.
--
-- Znikaja: siatki kopiowane co rok (CurriculumVersion/Entry), wzorce tygodnia i terminy
-- starego generatora (ScheduleTemplate/Entry), kalendarze roczne (SemesterCalendar)
-- i reczna lista swiat (PublicHoliday). Grupy traca pola starego modelu (nazwa, rok
-- akademicki, rok studiow, tryb, typ) — naleza do rocznika, a nazwe licza sie same.
--
-- UWAGA: dane starego planu musza byc wczesniej przeniesione skryptami etapow 4-5
-- (zrobione przy tworzeniu db/planista8-dump.sql). Bramka nizej pilnuje, zeby nie
-- skasowac planu, ktorego nikt nie przeniosl.

DO $$
DECLARE stare INT; nowe INT;
BEGIN
  SELECT count(*) INTO stare FROM "ScheduleEntry";
  SELECT count(*) INTO nowe FROM "Occurrence";
  IF stare > 0 AND nowe = 0 THEN
    RAISE EXCEPTION 'Stary plan (% terminow) nie zostal przeniesiony do nowego modelu — uruchom najpierw prisma/backfill (etap 4-5) albo wgraj db/planista8-dump.sql', stare;
  END IF;
  IF EXISTS (SELECT 1 FROM "StudentGroup" WHERE "cohortId" IS NULL OR "partitionKey" IS NULL) THEN
    RAISE EXCEPTION 'Sa grupy bez rocznika — migracja grup (etap 3) niekompletna';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "CurriculumEntry" DROP CONSTRAINT "CurriculumEntry_curriculumVersionId_fkey";

-- DropForeignKey
ALTER TABLE "CurriculumEntry" DROP CONSTRAINT "CurriculumEntry_instructorId_fkey";

-- DropForeignKey
ALTER TABLE "CurriculumEntry" DROP CONSTRAINT "CurriculumEntry_programEntryId_fkey";

-- DropForeignKey
ALTER TABLE "CurriculumEntry" DROP CONSTRAINT "CurriculumEntry_subjectId_fkey";

-- DropForeignKey
ALTER TABLE "CurriculumVersion" DROP CONSTRAINT "CurriculumVersion_specializationId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleEntry" DROP CONSTRAINT "ScheduleEntry_curriculumEntryId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleEntry" DROP CONSTRAINT "ScheduleEntry_endBlockId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleEntry" DROP CONSTRAINT "ScheduleEntry_facultyId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleEntry" DROP CONSTRAINT "ScheduleEntry_instructorId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleEntry" DROP CONSTRAINT "ScheduleEntry_roomId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleEntry" DROP CONSTRAINT "ScheduleEntry_startBlockId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleEntry" DROP CONSTRAINT "ScheduleEntry_studentGroupId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleEntry" DROP CONSTRAINT "ScheduleEntry_templateId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleTemplate" DROP CONSTRAINT "ScheduleTemplate_curriculumEntryId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleTemplate" DROP CONSTRAINT "ScheduleTemplate_endBlockId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleTemplate" DROP CONSTRAINT "ScheduleTemplate_facultyId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleTemplate" DROP CONSTRAINT "ScheduleTemplate_instructorId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleTemplate" DROP CONSTRAINT "ScheduleTemplate_roomId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleTemplate" DROP CONSTRAINT "ScheduleTemplate_startBlockId_fkey";

-- DropForeignKey
ALTER TABLE "ScheduleTemplate" DROP CONSTRAINT "ScheduleTemplate_studentGroupId_fkey";

-- DropForeignKey
ALTER TABLE "SemesterCalendar" DROP CONSTRAINT "SemesterCalendar_facultyId_fkey";

-- DropForeignKey
ALTER TABLE "StudentGroup" DROP CONSTRAINT "StudentGroup_cohortId_fkey";

-- DropForeignKey
ALTER TABLE "StudentGroup" DROP CONSTRAINT "StudentGroup_fieldOfStudyId_fkey";


DROP INDEX "StudentGroup_name_academicYear_key";

-- AlterTable
ALTER TABLE "StudentGroup" DROP COLUMN "academicYear",
DROP COLUMN "fieldOfStudyId",
DROP COLUMN "name",
DROP COLUMN "studyMode",
DROP COLUMN "studyYear",
DROP COLUMN "type",
ALTER COLUMN "cohortId" SET NOT NULL,
ALTER COLUMN "partitionKey" SET NOT NULL;

-- DropTable
DROP TABLE "CurriculumEntry";

-- DropTable
DROP TABLE "CurriculumVersion";

-- DropTable
DROP TABLE "PublicHoliday";

-- DropTable
DROP TABLE "ScheduleEntry";

-- DropTable
DROP TABLE "ScheduleTemplate";

-- DropTable
DROP TABLE "SemesterCalendar";

-- DropEnum
DROP TYPE "GroupType";

-- DropEnum
DROP TYPE "WeekType";

-- AddForeignKey
ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

