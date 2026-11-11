import type { ComponentType } from 'react';
import { Routes, Route } from 'react-router-dom';
import LoginPage from '@/pages/LoginPage';
import FacultiesPage from '@/pages/FacultiesPage';
import BuildingsPage from '@/pages/BuildingsPage';
import InstructorsPage from '@/pages/InstructorsPage';
import TimeGridsPage from '@/pages/TimeGridsPage';
import CurriculumPage from '@/pages/CurriculumPage';
import ProgramVersionPage from '@/pages/curriculum/ProgramVersionPage';
import CohortsPage from '@/pages/CohortsPage';
import ObsadaPage from '@/pages/ObsadaPage';
import PlanPage from '@/pages/PlanPage';
import TermSetupPage from '@/pages/TermSetupPage';
import MyPlanPage from '@/pages/MyPlanPage';
import RequestsPage from '@/pages/RequestsPage';
import TermCalendarPage from '@/pages/TermCalendarPage';
import DashboardPage from '@/pages/DashboardPage';
import UsersPage from '@/pages/UsersPage';
import NotFoundPage from '@/pages/NotFoundPage';
import ProtectedRoute from '@/components/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { NAV_ITEMS } from '@/lib/navigation';

/** Strony podpiete pod trasy z NAV_ITEMS. */
const PAGES: Record<string, ComponentType> = {
  '/': DashboardPage,
  '/curriculum': CurriculumPage,
  '/cohorts': CohortsPage,
  '/obsada': ObsadaPage,
  '/plan': PlanPage,
  '/setup': TermSetupPage,
  '/my-plan': MyPlanPage,
  '/requests': RequestsPage,
  '/calendar': TermCalendarPage,
  '/faculties': FacultiesPage,
  '/buildings': BuildingsPage,
  '/instructors': InstructorsPage,
  '/time-grids': TimeGridsPage,
  '/users': UsersPage,
};

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        {/* Trasy generujemy z tej samej konfiguracji co sidebar — role nie moga sie rozjechac. */}
        {NAV_ITEMS.map((item) => {
          const Page = PAGES[item.to];
          return (
            <Route
              key={item.to}
              // Strony semestralne niosa klucz semestru w adresie (/calendar/2026-L);
              // bez klucza strona sama przekieruje na wlasciwy semestr.
              path={item.termScoped ? `${item.to}/:termKey?` : item.to}
              element={
                <ProtectedRoute roles={item.roles}>
                  <Page />
                </ProtectedRoute>
              }
            />
          );
        })}

        {/* Podstrona edytora konkretnej siatki — poza NAV_ITEMS, bo nie ma wlasnej
            pozycji w menu, ale breadcrumb i podswietlenie dziala przez prefiks /curriculum. */}
        <Route
          path="/curriculum/program/:versionId"
          element={
            <ProtectedRoute roles={['ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR']}>
              <ProgramVersionPage />
            </ProtectedRoute>
          }
        />

        {/* Nieznany adres — komunikat w ramach aplikacji (niezalogowany trafi najpierw na logowanie). */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
