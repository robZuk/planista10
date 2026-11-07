-- Etap 5 nowego modelu: plan (Placement), wyjatki terminow i terminy (Occurrence).
-- Dane zimy 2024/25 przenosi skrypt prisma/backfill/etap5-plan.ts (wzorce -> umieszczenia,
-- terminy -> terminy), bo dopasowanie do zajec korzysta z logiki w TypeScript.

-- CreateEnum
CREATE TYPE "PlacementCycle" AS ENUM ('WEEK', 'ZJAZD');

-- CreateEnum
CREATE TYPE "PlacementPattern" AS ENUM ('ALL', 'EVEN', 'ODD', 'LIST');

-- CreateEnum
CREATE TYPE "ExceptionAction" AS ENUM ('CANCEL', 'MODIFY');

-- CreateEnum
CREATE TYPE "OccurrenceKind" AS ENUM ('DERIVED', 'MANUAL');


-- AlterTable
ALTER TABLE "TermCalendar" ADD COLUMN     "lastGeneratedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Placement" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "startOrder" INTEGER NOT NULL,
    "endOrder" INTEGER NOT NULL,
    "roomId" TEXT NOT NULL,
    "instructorId" TEXT,
    "cycle" "PlacementCycle" NOT NULL DEFAULT 'WEEK',
    "pattern" "PlacementPattern" NOT NULL DEFAULT 'ALL',
    "numbers" INTEGER[],
    "fromIndex" INTEGER,
    "toIndex" INTEGER,
    "jointKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Placement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementException" (
    "id" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "originalDate" DATE NOT NULL,
    "action" "ExceptionAction" NOT NULL,
    "newDate" DATE,
    "newStartOrder" INTEGER,
    "newEndOrder" INTEGER,
    "newRoomId" TEXT,
    "newInstructorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Occurrence" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "placementId" TEXT,
    "originalDate" DATE,
    "date" DATE NOT NULL,
    "startOrder" INTEGER NOT NULL,
    "endOrder" INTEGER NOT NULL,
    "roomId" TEXT NOT NULL,
    "instructorId" TEXT,
    "groupId" TEXT NOT NULL,
    "kind" "OccurrenceKind" NOT NULL DEFAULT 'DERIVED',
    "status" "EntryStatus" NOT NULL DEFAULT 'SCHEDULED',
    "jointKey" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Placement_termId_facultyId_idx" ON "Placement"("termId", "facultyId");

-- CreateIndex
CREATE INDEX "Placement_sectionId_idx" ON "Placement"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementException_placementId_originalDate_key" ON "PlacementException"("placementId", "originalDate");

-- CreateIndex
CREATE INDEX "Occurrence_termId_facultyId_idx" ON "Occurrence"("termId", "facultyId");

-- CreateIndex
CREATE INDEX "Occurrence_date_roomId_idx" ON "Occurrence"("date", "roomId");

-- CreateIndex
CREATE INDEX "Occurrence_date_instructorId_idx" ON "Occurrence"("date", "instructorId");

-- CreateIndex
CREATE INDEX "Occurrence_sectionId_idx" ON "Occurrence"("sectionId");

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ClassSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementException" ADD CONSTRAINT "PlacementException_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "Placement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ClassSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "Placement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudentGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

