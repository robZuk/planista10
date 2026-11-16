-- Katedry: jednostki, ktore przysylaja obciazenia swoich prowadzacych (KEO-WE, KPT-WM, SJO).
-- Katedra zwykle nalezy do wydzialu; jednostka miedzywydzialowa (SJO, prowadzacy zewnetrzni)
-- nie ma wydzialu. Prowadzacy moze miec katedre (opcjonalnie) — dotychczasowi zostaja bez niej.
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "facultyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- Skrot unikalny w wydziale...
CREATE UNIQUE INDEX "Department_facultyId_shortName_key" ON "Department"("facultyId", "shortName");
-- ...i wsrod jednostek bez wydzialu (NULL-e w zwyklym indeksie unikalnym sie nie zderzaja;
-- indeks czesciowy — Prisma go nie wyraza).
CREATE UNIQUE INDEX "Department_shortName_noFaculty_key" ON "Department"("shortName") WHERE "facultyId" IS NULL;

-- Wydzialu z katedrami nie da sie usunac (katedry nie staja sie po cichu miedzywydzialowe).
ALTER TABLE "Department" ADD CONSTRAINT "Department_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Instructor" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "Instructor" ADD CONSTRAINT "Instructor_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
