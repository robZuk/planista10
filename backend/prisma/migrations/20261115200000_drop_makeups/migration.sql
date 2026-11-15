-- planista10: bez odrobien — ani na studiach stacjonarnych, ani na niestacjonarnych.
-- Odwolany termin nie dostaje terminu odrobienia (jego godziny przepadaja); zajecia, ktore maja
-- sie odbyc w innym dniu, planista przenosi. Termin reczny (kind = MANUAL) to zwykle zajecia
-- dodatkowe — liczy sie do godzin jak kazdy inny.

-- Termin reczny mial status MAKEUP ("odrobienie"); reczny wyroznia juz kind = MANUAL.
UPDATE "Occurrence" SET "status" = 'SCHEDULED' WHERE "status" = 'MAKEUP';

-- Powiazanie odrobienie -> odwolany termin (klucz obcy i dawny klucz tekstowy lib/occurrenceKey).
ALTER TABLE "Occurrence" DROP CONSTRAINT "Occurrence_makeupOfId_fkey";
DROP INDEX "Occurrence_makeupOfId_idx";
DROP INDEX "Occurrence_makeupOfKey_idx";
ALTER TABLE "Occurrence" DROP COLUMN "makeupOfId",
DROP COLUMN "makeupOfKey";

-- EntryStatus bez MAKEUP: Postgres nie usuwa wartosci enuma, wiec nowy typ zastepuje stary.
ALTER TYPE "EntryStatus" RENAME TO "EntryStatus_old";
CREATE TYPE "EntryStatus" AS ENUM ('SCHEDULED', 'CANCELLED');
ALTER TABLE "Occurrence" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Occurrence" ALTER COLUMN "status" TYPE "EntryStatus" USING ("status"::text::"EntryStatus");
ALTER TABLE "Occurrence" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';
DROP TYPE "EntryStatus_old";
