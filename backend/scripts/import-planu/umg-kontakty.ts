/**
 * Poprawka prowadzacych z importu planu WM (same nazwiska, e-mail @plan-wm.invalid) danymi z bazy
 * kontaktow UMG (https://www.umg.edu.pl/baza-kontaktow, wyszukiwarka kontakt_wyniki): imie, tytul,
 * e-mail, katedra i wydzial. Struktura jednostek jak na stronie: nowy Wydzial Informatyki z zakladami,
 * brakujace katedry WE/WN/WZNJ, nazwy katedr WM wg strony (skroty zostaja). Duplikaty z literowek
 * w PDF (ten sam e-mail) scalane w jeden rekord — obsada, plan i terminy przechodza na niego.
 *
 * Dane: dane/umg-kontakty.json (z wynikow wyszukiwarki). Uzycie:
 *   npx tsx scripts/import-planu/umg-kontakty.ts            # podglad
 *   npx tsx scripts/import-planu/umg-kontakty.ts --apply    # zapis (jedna transakcja)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../../src/lib/prisma';

interface Person {
  id: string;
  was: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string;
  faculty: string | null;
  department: string | null;
}
interface Plan {
  units: {
    faculties: { shortName: string; name: string }[];
    departments: { faculty: string | null; shortName: string; name: string }[];
  };
  people: Person[];
  skipped: string[];
}

const apply = process.argv.includes('--apply');
const plan: Plan = JSON.parse(readFileSync(join(__dirname, 'dane/umg-kontakty.json'), 'utf8'));

async function main() {
  await prisma.$transaction(
    async (tx) => {
      // Wydzialy i katedry.
      const faculties = new Map((await tx.faculty.findMany()).map((f) => [f.shortName, f]));
      for (const f of plan.units.faculties) {
        if (faculties.has(f.shortName)) continue;
        console.log(`+ wydzial ${f.shortName} — ${f.name}`);
        faculties.set(f.shortName, await tx.faculty.create({ data: f }));
      }
      const facultyId = (short: string | null) => {
        if (!short) return null;
        const f = faculties.get(short);
        if (!f) throw new Error(`Brak wydzialu ${short}`);
        return f.id;
      };
      for (const d of plan.units.departments) {
        const fid = facultyId(d.faculty);
        const existing = await tx.department.findFirst({ where: { facultyId: fid, shortName: d.shortName } });
        if (!existing) {
          console.log(`+ katedra ${d.shortName}-${d.faculty} — ${d.name}`);
          await tx.department.create({ data: { shortName: d.shortName, name: d.name, facultyId: fid } });
        } else if (existing.name !== d.name) {
          console.log(`~ katedra ${d.shortName}-${d.faculty}: "${existing.name}" -> "${d.name}"`);
          await tx.department.update({ where: { id: existing.id }, data: { name: d.name } });
        }
      }
      const departments = await tx.department.findMany({ include: { faculty: true } });
      const departmentOf = (p: Person) => {
        if (!p.department) return null;
        const d = departments.find((x) => x.shortName === p.department && (x.faculty?.shortName ?? null) === p.faculty);
        if (!d) throw new Error(`Brak katedry ${p.department}-${p.faculty}`);
        return d;
      };

      // Scalenia: rekordy z tym samym e-mailem -> zostaje ten z najwieksza liczba umieszczen.
      const byEmail = new Map<string, Person[]>();
      for (const p of plan.people) byEmail.set(p.email, [...(byEmail.get(p.email) ?? []), p]);
      const removed = new Set<string>();
      for (const [email, group] of byEmail) {
        if (group.length < 2) continue;
        const counts = await Promise.all(group.map((p) => tx.placement.count({ where: { instructorId: p.id } })));
        const keeper = group[counts.indexOf(Math.max(...counts))]!;
        for (const dup of group.filter((p) => p !== keeper)) {
          const [si, pl, oc, ex, eb] = await Promise.all([
            tx.sectionInstructor.updateMany({ where: { instructorId: dup.id }, data: { instructorId: keeper.id } }),
            tx.placement.updateMany({ where: { instructorId: dup.id }, data: { instructorId: keeper.id } }),
            tx.occurrence.updateMany({ where: { instructorId: dup.id }, data: { instructorId: keeper.id } }),
            tx.placementException.updateMany({ where: { newInstructorId: dup.id }, data: { newInstructorId: keeper.id } }),
            tx.externalBusy.updateMany({ where: { instructorId: dup.id }, data: { instructorId: keeper.id } }),
          ]);
          const user = await tx.user.findFirst({ where: { instructorId: dup.id } });
          if (user) throw new Error(`Duplikat ${dup.was} ma konto — scal recznie`);
          await tx.instructor.delete({ where: { id: dup.id } });
          removed.add(dup.id);
          console.log(`= scalono "${dup.was}" -> "${keeper.was}" (${email}): obsada ${si.count}, umieszczenia ${pl.count}, terminy ${oc.count}, przeniesienia ${ex.count}, zajetosci ${eb.count}`);
        }
      }

      // Dane osob.
      let changed = 0;
      for (const p of plan.people) {
        if (removed.has(p.id)) continue;
        const clash = await tx.instructor.findFirst({ where: { email: p.email, id: { not: p.id } } });
        if (clash) throw new Error(`E-mail ${p.email} ma juz ${clash.firstName} ${clash.lastName}`);
        const dept = departmentOf(p);
        await tx.instructor.update({
          where: { id: p.id },
          data: {
            firstName: p.firstName,
            lastName: p.lastName,
            title: p.title,
            email: p.email,
            departmentId: dept?.id ?? null,
            facultyId: dept ? dept.facultyId : facultyId(p.faculty),
          },
        });
        changed++;
      }
      console.log(`Prowadzacy poprawieni: ${changed}, scaleni: ${removed.size}, bez zmian (nie ma na stronie albo niejednoznaczni): ${plan.skipped.join(', ')}`);
      if (!apply) throw new Error('PODGLAD — nic nie zapisano (uruchom z --apply)');
    },
    { timeout: 60_000 },
  );
}

main()
  .catch((e: Error) => {
    console.log(e.message);
    if (!e.message.startsWith('PODGLAD')) process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
