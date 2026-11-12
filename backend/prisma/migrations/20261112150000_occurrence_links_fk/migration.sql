-- Etap 2 przejscia z trwalych kluczy tekstowych na klucze obce: odrobienie wskazuje odwolany
-- termin (makeupOfId), zgloszenie — swoj termin (occurrenceId). Kolumny tekstowe zostaja
-- (kod wypelnia oba), dopoki kod nie przejdzie na klucze obce.

ALTER TABLE "Occurrence" ADD COLUMN "makeupOfId" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN "occurrenceId" TEXT;

CREATE INDEX "Occurrence_makeupOfId_idx" ON "Occurrence"("makeupOfId");
CREATE INDEX "ChangeRequest_occurrenceId_idx" ON "ChangeRequest"("occurrenceId");

ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_makeupOfId_fkey" FOREIGN KEY ("makeupOfId") REFERENCES "Occurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Wypelnienie z kluczy tekstowych (lib/occurrenceKey): "o:<id>" albo "p:<umieszczenie>|<data z wzorca>".
UPDATE "Occurrence" m SET "makeupOfId" = o."id"
FROM "Occurrence" o
WHERE m."makeupOfKey" LIKE 'o:%' AND o."id" = substring(m."makeupOfKey" FROM 3);

UPDATE "Occurrence" m SET "makeupOfId" = o."id"
FROM "Occurrence" o
WHERE m."makeupOfId" IS NULL AND m."makeupOfKey" LIKE 'p:%' AND o."kind" = 'DERIVED'
  AND m."makeupOfKey" = 'p:' || o."placementId" || '|' || to_char(o."originalDate", 'YYYY-MM-DD');

UPDATE "ChangeRequest" r SET "occurrenceId" = o."id"
FROM "Occurrence" o
WHERE r."occurrenceKey" LIKE 'o:%' AND o."id" = substring(r."occurrenceKey" FROM 3);

UPDATE "ChangeRequest" r SET "occurrenceId" = o."id"
FROM "Occurrence" o
WHERE r."occurrenceId" IS NULL AND r."occurrenceKey" LIKE 'p:%' AND o."kind" = 'DERIVED'
  AND r."occurrenceKey" = 'p:' || o."placementId" || '|' || to_char(o."originalDate", 'YYYY-MM-DD');
