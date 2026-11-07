import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader';
import { FacultySelector } from '@/components/FacultySelector';
import ProgramsTab from './curriculum/ProgramsTab';
import StructureTab from './curriculum/StructureTab';
import SubjectsTab from './curriculum/SubjectsTab';

/**
 * Programy studiow w osobnych zakladkach:
 *  - Programy     — program (kierunek + poziom + tryb) i jego wersje; wersja obowiazuje wiele rocznikow
 *  - Struktura    — kierunki i nalezace do nich specjalnosci
 *  - Przedmioty   — slownik przedmiotow wspolny dla calej uczelni
 */
export default function CurriculumPage() {
  const [tab, setTab] = useState('programs');

  return (
    <>
      <PageHeader
        title="Programy studiow"
        description="Co, w ktorym semestrze i w jakim wymiarze godzin. Wersja programu obowiazuje wiele rocznikow — bez kopiowania co rok."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="programs">Programy</TabsTrigger>
            <TabsTrigger value="structure">Kierunki i specjalnosci</TabsTrigger>
            <TabsTrigger value="subjects">Przedmioty</TabsTrigger>
          </TabsList>
          {/* Przedmioty sa wspolne dla calej uczelni (brak facultyId), wiec filtr tam nie pasuje. */}
          {tab !== 'subjects' && <FacultySelector />}
        </div>

        <TabsContent value="programs" className="mt-4">
          <ProgramsTab />
        </TabsContent>
        <TabsContent value="structure" className="mt-4">
          <StructureTab />
        </TabsContent>
        <TabsContent value="subjects" className="mt-4">
          <SubjectsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
