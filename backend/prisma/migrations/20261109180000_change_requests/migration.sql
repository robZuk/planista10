-- Zgloszenia zmian prowadzacych (odwolanie, przeniesienie, odrobienie) i powiadomienia w aplikacji.
-- Odrobienie wskazuje odwolany termin trwalym kluczem (makeupOfKey), bo terminy z wzorca
-- dostaja nowe id przy kazdym generowaniu.

-- CreateEnum
CREATE TYPE "ChangeRequestKind" AS ENUM ('CANCEL', 'MOVE', 'MAKEUP');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('REQUEST_CREATED', 'REQUEST_WITHDRAWN', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'CLASS_CANCELLED', 'CLASS_CHANGED', 'MAKEUP_SCHEDULED');

-- AlterTable
ALTER TABLE "Occurrence" ADD COLUMN     "makeupOfKey" TEXT;

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "requestedById" TEXT,
    "kind" "ChangeRequestKind" NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "occurrenceKey" TEXT NOT NULL,
    "originalDate" DATE NOT NULL,
    "originalStartMinute" INTEGER NOT NULL,
    "originalEndMinute" INTEGER NOT NULL,
    "newDate" DATE,
    "newStartOrder" INTEGER,
    "newEndOrder" INTEGER,
    "newRoomId" TEXT,
    "newOnline" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "requestId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeRequest_facultyId_status_idx" ON "ChangeRequest"("facultyId", "status");

-- CreateIndex
CREATE INDEX "ChangeRequest_instructorId_status_idx" ON "ChangeRequest"("instructorId", "status");

-- CreateIndex
CREATE INDEX "ChangeRequest_occurrenceKey_idx" ON "ChangeRequest"("occurrenceKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Occurrence_makeupOfKey_idx" ON "Occurrence"("makeupOfKey");

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ClassSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_newRoomId_fkey" FOREIGN KEY ("newRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ChangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

