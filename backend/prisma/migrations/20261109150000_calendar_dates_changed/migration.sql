-- Kiedy ostatnio zmienily sie daty kalendarza (rodzaj, daty semestru, przerwy, dni wyjatkowe,
-- zjazdy) — od nich zaleza terminy. Zmiana po generowaniu = "terminy nieaktualne" rocznikow
-- tego kalendarza. Istniejace kalendarze: czas utworzenia (generowanie bylo zawsze pozniej),
-- zeby migracja nie oznaczyla wszystkich terminow jako nieaktualnych.
ALTER TABLE "TermCalendar" ADD COLUMN "datesChangedAt" TIMESTAMP(3);
UPDATE "TermCalendar" SET "datesChangedAt" = "createdAt";
ALTER TABLE "TermCalendar" ALTER COLUMN "datesChangedAt" SET NOT NULL;
ALTER TABLE "TermCalendar" ALTER COLUMN "datesChangedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Zmiana numeru semestru albo kalendarza rocznika w semestrze — tez unieaktualnia terminy.
-- Istniejace wpisy: null (brak znanej zmiany po generowaniu).
ALTER TABLE "CohortTerm" ADD COLUMN "changedAt" TIMESTAMP(3);
