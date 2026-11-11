-- Odcisk kalendarza, z ktorego wygenerowano terminy rocznika (kalendarz, semestr, daty).
-- "Terminy nieaktualne" z powodu kalendarza = odcisk inny niz teraz (a nie: pozniejsza zmiana).
ALTER TABLE "CohortGeneration" ADD COLUMN "calendarKey" TEXT;
