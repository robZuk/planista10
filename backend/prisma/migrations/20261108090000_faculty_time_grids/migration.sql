-- Siatki godzin wydzialow: kazdy wydzial ma siatke stacjonarna i niestacjonarna (bloki o dowolnym
-- starcie i dlugosci, dni zajec z oknem godzin). Dotychczasowa globalna siatka trafia do kazdej
-- pary wydzial x tryb; dni domyslne = dotychczasowa regula w kodzie (st. pn-pt; nst. pt od 15:00,
-- sob, nd). Terminy dostaja rzeczywisty czas w minutach (kolizje miedzy siatkami wydzialow).

-- Occurrence: rzeczywisty czas z jedynej dotad siatki (po numerach blokow) — przed kopiowaniem blokow
ALTER TABLE "Occurrence" ADD COLUMN "startMinute" INTEGER;
ALTER TABLE "Occurrence" ADD COLUMN "endMinute" INTEGER;

UPDATE "Occurrence" o SET
    "startMinute" = split_part(sb."startTime", ':', 1)::int * 60 + split_part(sb."startTime", ':', 2)::int,
    "endMinute"   = split_part(eb."endTime", ':', 1)::int * 60 + split_part(eb."endTime", ':', 2)::int
FROM "TimeBlock" sb, "TimeBlock" eb
WHERE sb."order" = o."startOrder" AND eb."order" = o."endOrder";

-- Termin spoza siatki (nie powinien istniec) — czas jak w siatce 07:00 + 1 h/blok.
UPDATE "Occurrence" SET
    "startMinute" = 360 + "startOrder" * 60,
    "endMinute"   = 420 + "endOrder" * 60
WHERE "startMinute" IS NULL OR "endMinute" IS NULL;

ALTER TABLE "Occurrence" ALTER COLUMN "startMinute" SET NOT NULL;
ALTER TABLE "Occurrence" ALTER COLUMN "endMinute" SET NOT NULL;

-- CreateTable
CREATE TABLE "TimeGrid" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "studyMode" "StudyMode" NOT NULL,
    "days" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeGrid_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimeGrid_facultyId_studyMode_key" ON "TimeGrid"("facultyId", "studyMode");
ALTER TABLE "TimeGrid" ADD CONSTRAINT "TimeGrid_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "TimeGrid" ("id", "facultyId", "studyMode", "days", "updatedAt")
SELECT gen_random_uuid()::text, f."id", 'FULL_TIME',
       '[{"day":"MONDAY","from":null,"to":null},{"day":"TUESDAY","from":null,"to":null},{"day":"WEDNESDAY","from":null,"to":null},{"day":"THURSDAY","from":null,"to":null},{"day":"FRIDAY","from":null,"to":null}]'::jsonb,
       CURRENT_TIMESTAMP
FROM "Faculty" f;

INSERT INTO "TimeGrid" ("id", "facultyId", "studyMode", "days", "updatedAt")
SELECT gen_random_uuid()::text, f."id", 'PART_TIME',
       '[{"day":"FRIDAY","from":"15:00","to":null},{"day":"SATURDAY","from":null,"to":null},{"day":"SUNDAY","from":null,"to":null}]'::jsonb,
       CURRENT_TIMESTAMP
FROM "Faculty" f;

-- TimeBlock -> siatka: globalne bloki kopiowane do kazdej siatki, oryginaly usuwane
DROP INDEX "TimeBlock_order_key";
DROP INDEX "TimeBlock_startTime_key";
DROP INDEX "TimeBlock_endTime_key";

ALTER TABLE "TimeBlock" ADD COLUMN "gridId" TEXT;

INSERT INTO "TimeBlock" ("id", "gridId", "order", "startTime", "endTime", "label", "createdAt")
SELECT gen_random_uuid()::text, g."id", b."order", b."startTime", b."endTime", b."label", CURRENT_TIMESTAMP
FROM "TimeBlock" b CROSS JOIN "TimeGrid" g
WHERE b."gridId" IS NULL;

DELETE FROM "TimeBlock" WHERE "gridId" IS NULL;

ALTER TABLE "TimeBlock" ALTER COLUMN "gridId" SET NOT NULL;
CREATE UNIQUE INDEX "TimeBlock_gridId_order_key" ON "TimeBlock"("gridId", "order");
CREATE UNIQUE INDEX "TimeBlock_gridId_startTime_key" ON "TimeBlock"("gridId", "startTime");
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_gridId_fkey" FOREIGN KEY ("gridId") REFERENCES "TimeGrid"("id") ON DELETE CASCADE ON UPDATE CASCADE;
