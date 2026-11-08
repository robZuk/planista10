import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { syncSections } from '../src/services/sections';
import { defaultGridsCreate } from '../src/services/timeGrids';
import { defaultTermDates, termOfDate } from '../src/lib/terms';
import { addDays, isoDate, todayIso } from '../src/lib/isoDate';

const prisma = new PrismaClient();

/**
 * Seed — minimalne dane startowe nowego modelu (do developmentu i testow e2e).
 *
 * Semestr "biezacy" liczymy z dzisiejszej daty, zeby seed sie nie starzal. Powstaje:
 * katalog (wydzialy, sale, prowadzacy, przedmioty), program EDST z jedna zatwierdzona
 * wersja, nabor startujacy w biezacym roku akademickim z drzewem grup, kalendarze
 * WM na zime i lato, zajecia semestru (synchronizacja) i obsada. Planu (umieszczen)
 * seed NIE uklada — to zawsze robi planista.
 *
 * Wzorzec "wyczysc i wstaw": idempotentny, mozna uruchamiac wielokrotnie.
 * Pelne dane deweloperskie (zima 2024/25) sa w db/planista9-dump.sql.
 */
async function main() {
  console.log('🌱 Seed: czyszczenie...');
  await prisma.occurrence.deleteMany();
  await prisma.placement.deleteMany();
  await prisma.classSection.deleteMany();
  await prisma.cohortTerm.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.studentGroup.updateMany({ data: { parentGroupId: null } });
  await prisma.studentGroup.deleteMany();
  await prisma.cohort.deleteMany();
  await prisma.programEntry.deleteMany();
  await prisma.programVersion.updateMany({ data: { clonedFromId: null } });
  await prisma.programVersion.deleteMany();
  await prisma.program.deleteMany();
  await prisma.termCalendar.deleteMany();
  await prisma.academicTerm.deleteMany();
  await prisma.timeGrid.deleteMany(); // bloki znikaja kaskadowo
  await prisma.subject.deleteMany();
  await prisma.room.deleteMany();
  await prisma.building.deleteMany();
  await prisma.instructor.deleteMany();
  await prisma.specialization.deleteMany();
  await prisma.fieldOfStudy.deleteMany();
  await prisma.faculty.deleteMany();

  // ─── Struktura uczelni ───────────────────────────────────────
  console.log('🏛️  Struktura uczelni...');
  const wm = await prisma.faculty.create({ data: { name: 'Wydzial Mechaniczny', shortName: 'WM' } });
  await prisma.faculty.createMany({
    data: [
      { name: 'Wydzial Elektryczny', shortName: 'WE' },
      { name: 'Wydzial Nawigacyjny', shortName: 'WN' },
      { name: 'Wydzial Zarzadzania i Nauk o Jakosci', shortName: 'WZNJ' },
    ],
  });
  // Siatki godzin: kazdy wydzial — stacjonarna i niestacjonarna (07:00-20:00 co 1 h, dni domyslne).
  console.log('⏰ Siatki godzin wydzialow...');
  for (const faculty of await prisma.faculty.findMany({ select: { id: true } })) {
    for (const grid of defaultGridsCreate()) await prisma.timeGrid.create({ data: { ...grid, facultyId: faculty.id } });
  }
  const edst = await prisma.fieldOfStudy.create({
    data: { name: 'Eksploatacja i Diagnostyka Systemow Technicznych', shortName: 'EDST', facultyId: wm.id },
  });
  const dut = await prisma.specialization.create({
    data: { name: 'Diagnostyka Urzadzen Technicznych', shortName: 'DUT', fieldOfStudyId: edst.id },
  });
  await prisma.specialization.create({
    data: { name: 'Zarzadzanie Eksploatacja Elektrowni Wiatrowych', shortName: 'ZEEW', fieldOfStudyId: edst.id },
  });

  console.log('📚 Przedmioty, sale, prowadzacy...');
  const [matematyka, fizyka, diagnostyka] = await Promise.all([
    prisma.subject.create({ data: { name: 'Matematyka I', code: 'EDST-101' } }),
    prisma.subject.create({ data: { name: 'Fizyka', code: 'EDST-102' } }),
    prisma.subject.create({ data: { name: 'Podstawy Diagnostyki Technicznej', code: 'EDST-103' } }),
  ]);
  const building = await prisma.building.create({
    data: {
      name: 'Budynek A',
      address: 'ul. Morska 81-87',
      facultyId: wm.id,
      rooms: {
        create: [
          { number: '101', type: 'LECTURE', capacity: 120 },
          { number: '102', type: 'EXERCISE', capacity: 30 },
          { number: '201', type: 'LAB', capacity: 16 },
        ],
      },
    },
    include: { rooms: true },
  });
  const kowalski = await prisma.instructor.create({
    data: { firstName: 'Jan', lastName: 'Kowalski', email: 'jan.kowalski@umg.edu.pl', title: 'prof. dr hab.', facultyId: wm.id },
  });
  const nowak = await prisma.instructor.create({
    data: { firstName: 'Anna', lastName: 'Nowak', email: 'anna.nowak@umg.edu.pl', title: 'dr inz.', facultyId: wm.id },
  });

  // ─── Semestry i kalendarze ───────────────────────────────────
  console.log('📅 Semestry i kalendarze...');
  const startYear = termOfDate(todayIso()).startYear;
  const winter = await prisma.academicTerm.create({ data: { startYear, type: 'WINTER' } });
  const summer = await prisma.academicTerm.create({ data: { startYear, type: 'SUMMER' } });
  const winterDates = defaultTermDates(winter);
  const summerDates = defaultTermDates(summer);
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
  await prisma.termCalendar.create({
    data: {
      termId: winter.id,
      facultyId: wm.id,
      studyMode: 'FULL_TIME',
      kind: 'WEEKLY',
      startDate: d(winterDates.startDate),
      endDate: d(winterDates.endDate),
      breaks: {
        create: [{ name: 'Przerwa swiateczna', startDate: d(isoDate(startYear, 12, 23)), endDate: d(isoDate(startYear + 1, 1, 1)) }],
      },
    },
  });
  await prisma.termCalendar.create({
    data: {
      termId: summer.id,
      facultyId: wm.id,
      studyMode: 'FULL_TIME',
      kind: 'WEEKLY',
      startDate: d(summerDates.startDate),
      endDate: d(summerDates.endDate),
    },
  });
  // Niestacjonarne: zjazdy co 2 tygodnie od pierwszego piatku po starcie zimy.
  let firstFriday = winterDates.startDate;
  while (new Date(`${firstFriday}T12:00:00Z`).getUTCDay() !== 5) firstFriday = addDays(firstFriday, 1);
  await prisma.termCalendar.create({
    data: {
      termId: winter.id,
      facultyId: wm.id,
      studyMode: 'PART_TIME',
      kind: 'ZJAZD',
      startDate: d(winterDates.startDate),
      endDate: d(winterDates.endDate),
      zjazdy: {
        create: Array.from({ length: 8 }, (_, i) => {
          const start = addDays(firstFriday, i * 14);
          return { number: i + 1, startDate: d(start), endDate: d(addDays(start, 2)) };
        }),
      },
    },
  });

  // ─── Program studiow ─────────────────────────────────────────
  console.log('🎓 Program studiow...');
  const program = await prisma.program.create({
    data: {
      code: 'EDST-S1',
      name: 'Eksploatacja i Diagnostyka Systemow Technicznych (stacjonarne, I stopnia)',
      fieldOfStudyId: edst.id,
      degreeLevel: 'BACHELOR',
      studyMode: 'FULL_TIME',
    },
  });
  const version = await prisma.programVersion.create({
    data: {
      programId: program.id,
      label: 'Wersja 1',
      status: 'APPROVED',
      totalSemesters: 7,
      entries: {
        create: [
          { subjectId: matematyka.id, semester: 1, orderInSemester: 1, hoursLecture: 30, hoursExercise: 30, ects: 6, assessmentType: 'EXAM' },
          { subjectId: fizyka.id, semester: 1, orderInSemester: 2, hoursLecture: 30, hoursLab: 15, ects: 5 },
          { subjectId: diagnostyka.id, semester: 2, orderInSemester: 1, hoursLecture: 15, hoursLab: 30, ects: 4, specializationId: dut.id },
        ],
      },
    },
  });

  // ─── Rocznik i grupy (nabor biezacego roku) ──────────────────
  console.log('👥 Rocznik i grupy...');
  const cohort = await prisma.cohort.create({
    data: { programId: program.id, programVersionId: version.id, startTermId: winter.id },
  });
  const root = await prisma.studentGroup.create({ data: { cohortId: cohort.id, partitionKey: 'ROOT', size: 60 } });
  const labs = [];
  for (const code of ['A', 'B']) {
    const exercise = await prisma.studentGroup.create({
      data: { cohortId: cohort.id, partitionKey: 'C', code, size: 30, parentGroupId: root.id },
    });
    for (const n of [1, 2]) {
      labs.push(
        await prisma.studentGroup.create({
          data: { cohortId: cohort.id, partitionKey: 'L', code: `${code}${n}`, size: 15, parentGroupId: exercise.id },
        }),
      );
    }
  }

  // ─── Zajecia i obsada (bez planu — plan uklada planista) ─────
  console.log('🧾 Zajecia semestru i obsada...');
  await syncSections(winter, { facultyId: wm.id, dryRun: false });
  const sections = await prisma.classSection.findMany({ where: { termId: winter.id } });
  await prisma.sectionInstructor.createMany({
    data: sections.map((s) => ({
      sectionId: s.id,
      instructorId: s.classType === 'LECTURE' ? kowalski.id : nowak.id,
      hours: s.hours,
    })),
  });

  // ─── Uzytkownicy ─────────────────────────────────────────────
  console.log('🔐 Uzytkownicy...');
  const hash = (plain: string) => bcrypt.hashSync(plain, 10);
  await prisma.user.create({
    data: { email: 'admin@umg.edu.pl', password: hash('Admin1234!'), role: 'ADMIN', name: 'Administrator' },
  });
  await prisma.user.create({
    data: { email: 'dziekanat@umg.edu.pl', password: hash('Dziekanat1234!'), role: 'DEAN_OFFICE', name: 'Dziekanat WM', facultyId: wm.id },
  });
  await prisma.user.create({
    data: { email: 'prowadzacy@umg.edu.pl', password: hash('Prowadzacy1234!'), role: 'INSTRUCTOR', name: 'Jan Kowalski', instructorId: kowalski.id },
  });
  // Student nalezy do najmniejszej grupy — wyklady rocznika i cwiczenia wynikaja z drzewa grup.
  await prisma.user.create({
    data: {
      email: 'student@umg.edu.pl',
      password: hash('Student1234!'),
      role: 'STUDENT',
      name: 'Student Testowy',
      studentGroups: { connect: [{ id: labs[0]!.id }] },
    },
  });

  console.log('✅ Seed zakonczony.');
  console.log(`   Semestr: ${startYear}/${startYear + 1}, zajec: ${sections.length}, sale: ${building.rooms.map((r) => r.number).join(', ')}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed nieudany:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
