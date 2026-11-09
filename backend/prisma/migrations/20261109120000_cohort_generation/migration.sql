-- Ostatnie "Generuj terminy" per rocznik i semestr (zamiast jednego znacznika na kalendarz,
-- ktory dzieli wiele rocznikow).
CREATE TABLE "CohortGeneration" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CohortGeneration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CohortGeneration_cohortId_termId_key" ON "CohortGeneration"("cohortId", "termId");

ALTER TABLE "CohortGeneration" ADD CONSTRAINT "CohortGeneration_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CohortGeneration" ADD CONSTRAINT "CohortGeneration_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Przeniesienie stanu: kazdy rocznik, ktory ma wygenerowane terminy w semestrze, dostaje czas
-- generowania swojego kalendarza — wybranego jak w services/plan.ts pickCalendar: wybrany
-- w Rocznikach (CohortTerm.calendarId), inaczej "Podstawowy", inaczej pierwszy kalendarz
-- wydzialu i trybu rocznika w tym semestrze. Dzieki temu "nieaktualne" nie zmienia sie przy
-- migracji; od teraz kazde generowanie zapisuje czas tylko rocznikom, ktore przeliczylo.
INSERT INTO "CohortGeneration" ("id", "cohortId", "termId", "generatedAt")
SELECT gen_random_uuid()::text, x."cohortId", x."termId", x."lastGeneratedAt"
FROM (
    SELECT DISTINCT ON (s."cohortId", s."termId")
           s."cohortId", s."termId", tc."lastGeneratedAt"
    FROM "ClassSection" s
    JOIN "Occurrence" o ON o."sectionId" = s."id" AND o."kind" = 'DERIVED'
    JOIN "Cohort" c ON c."id" = s."cohortId"
    JOIN "Program" p ON p."id" = c."programId"
    JOIN "FieldOfStudy" f ON f."id" = p."fieldOfStudyId"
    JOIN "TermCalendar" tc ON tc."termId" = s."termId" AND tc."facultyId" = f."facultyId" AND tc."studyMode" = p."studyMode"
    LEFT JOIN "CohortTerm" ct ON ct."cohortId" = s."cohortId" AND ct."termId" = s."termId"
    ORDER BY s."cohortId", s."termId",
             (tc."id" = ct."calendarId") DESC NULLS LAST,
             (tc."name" = 'Podstawowy') DESC,
             tc."id"
) x
-- Najpierw wybor kalendarza, dopiero potem odrzucenie niegenerowanych (nie bierzemy czasu innego wariantu).
WHERE x."lastGeneratedAt" IS NOT NULL;
