-- Jeden termin na date wzorca umieszczenia: "Generuj terminy" aktualizuje terminy w miejscu
-- (zachowuja id), zamiast usuwac i tworzyc je od nowa.
CREATE UNIQUE INDEX "Occurrence_placementId_originalDate_key" ON "Occurrence"("placementId", "originalDate");
