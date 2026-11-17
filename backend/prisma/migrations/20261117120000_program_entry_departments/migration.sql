-- Katedra prowadzaca forme zajec przedmiotu w programie (kolumna "Katedra" w zleceniu wydzialu).
-- Jedna katedra na pozycje programu i forme; "KMOiTR/KEO" = rozne katedry dla roznych form.
CREATE TABLE "ProgramEntryDepartment" (
    "programEntryId" TEXT NOT NULL,
    "classType" "ClassType" NOT NULL,
    "departmentId" TEXT NOT NULL,

    CONSTRAINT "ProgramEntryDepartment_pkey" PRIMARY KEY ("programEntryId","classType")
);

CREATE INDEX "ProgramEntryDepartment_departmentId_idx" ON "ProgramEntryDepartment"("departmentId");

-- Usuniecie pozycji programu zabiera jej katedry; katedry przypisanej do przedmiotow nie da sie usunac.
ALTER TABLE "ProgramEntryDepartment" ADD CONSTRAINT "ProgramEntryDepartment_programEntryId_fkey" FOREIGN KEY ("programEntryId") REFERENCES "ProgramEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramEntryDepartment" ADD CONSTRAINT "ProgramEntryDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
