-- planista10: bez odwolan — termin z wzorca planista tylko przenosi (stacjonarne: terminy tylko
-- do wgladu). Termin nie ma juz statusu, a poprawka terminu (PlacementException) to zawsze
-- przeniesienie.

-- Dawne odwolania wracaja do planu jak po "Przywroc": wyjatek CANCEL znika, a odwolany termin
-- z wzorca zostaje zwyklym terminem bez powodu odwolania (termin odwolany po przeniesieniu wraca
-- na miejsce z wzorca przy najblizszym "Generuj terminy"). Odwolany termin reczny nie ma
-- wzorca, do ktorego moglby wrocic — usuwamy go.
DELETE FROM "Occurrence" WHERE "status" = 'CANCELLED' AND "kind" = 'MANUAL';
UPDATE "Occurrence" SET "note" = NULL WHERE "status" = 'CANCELLED';
DELETE FROM "PlacementException" WHERE "action" = 'CANCEL';

ALTER TABLE "Occurrence" DROP COLUMN "status";
DROP TYPE "EntryStatus";

ALTER TABLE "PlacementException" DROP COLUMN "action";
DROP TYPE "ExceptionAction";
