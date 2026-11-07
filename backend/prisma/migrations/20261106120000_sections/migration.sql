-- Etap 4 nowego modelu: zajecia do przeprowadzenia (ClassSection) i obsada (SectionInstructor).
-- Dane (zima 2024/25) wypelnia skrypt prisma/backfill/etap4-sections.ts — wyprowadzenie
-- zajec z programu i grup jest w TypeScript (services/demand.ts), nie w SQL.

-- CreateEnum
CREATE TYPE "SectionStatus" AS ENUM ('ACTIVE', 'ORPHANED');


-- CreateTable
CREATE TABLE "ClassSection" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "programEntryId" TEXT NOT NULL,
    "classType" "ClassType" NOT NULL,
    "groupId" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "facultyId" TEXT NOT NULL,
    "status" "SectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionInstructor" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "instructorId" TEXT,
    "hours" INTEGER NOT NULL,

    CONSTRAINT "SectionInstructor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassSection_termId_facultyId_idx" ON "ClassSection"("termId", "facultyId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassSection_termId_programEntryId_classType_groupId_key" ON "ClassSection"("termId", "programEntryId", "classType", "groupId");

-- AddForeignKey
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_programEntryId_fkey" FOREIGN KEY ("programEntryId") REFERENCES "ProgramEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudentGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSection" ADD CONSTRAINT "ClassSection_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionInstructor" ADD CONSTRAINT "SectionInstructor_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionInstructor" ADD CONSTRAINT "SectionInstructor_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

