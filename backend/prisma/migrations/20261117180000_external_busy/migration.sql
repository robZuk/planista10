-- Zajetosci zewnetrzne: czas prowadzacego i/lub sali zajety poza planem w systemie (zajecia
-- innych wydzialow zgloszone mailem). Licza sie tylko do kolizji. Czas w minutach, konkretne daty.
CREATE TABLE "ExternalBusy" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "instructorId" TEXT,
    "roomId" TEXT,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "dates" DATE[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalBusy_pkey" PRIMARY KEY ("id"),
    -- Zajetosc dotyczy prowadzacego, sali albo obu — nigdy niczego (Prisma tego nie wyraza).
    CONSTRAINT "ExternalBusy_resource_check" CHECK ("instructorId" IS NOT NULL OR "roomId" IS NOT NULL),
    CONSTRAINT "ExternalBusy_minutes_check" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute")
);

CREATE INDEX "ExternalBusy_termId_idx" ON "ExternalBusy"("termId");

ALTER TABLE "ExternalBusy" ADD CONSTRAINT "ExternalBusy_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Usuniety prowadzacy/sala — jego zajetosc zewnetrzna traci sens.
ALTER TABLE "ExternalBusy" ADD CONSTRAINT "ExternalBusy_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBusy" ADD CONSTRAINT "ExternalBusy_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
