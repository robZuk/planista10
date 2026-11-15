-- Siatki dnia: wydzial x tryb moze miec kilka siatek godzin — podstawowa i siatki dla wybranych
-- dni z wlasnymi blokami (np. piatek niestacjonarnych 16:00, 16:50, ... przy innych blokach w sobote).
-- Dotychczasowe siatki zostaja siatkami podstawowymi.
ALTER TABLE "TimeGrid" ADD COLUMN "base" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX "TimeGrid_facultyId_studyMode_key";
CREATE INDEX "TimeGrid_facultyId_studyMode_idx" ON "TimeGrid"("facultyId", "studyMode");

-- Dokladnie jedna siatka podstawowa na wydzial i tryb (indeks czesciowy — Prisma go nie wyraza).
CREATE UNIQUE INDEX "TimeGrid_base_key" ON "TimeGrid"("facultyId", "studyMode") WHERE "base";
