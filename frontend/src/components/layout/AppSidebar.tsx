import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { NavUser } from './NavUser';
import { useAuthStore } from '@/store/authStore';
import { visibleGroups } from '@/lib/navigation';
import { fetchPendingRequests } from '@/api/requests';
import { plural } from '@/lib/setupSteps';

/**
 * Lewa nawigacja aplikacji.
 *
 * collapsible="icon" — Ctrl+B zwija panel do samych ikon (tooltipy pokazuja nazwy).
 * Na malych ekranach shadcn sam podmienia panel na wysuwany Sheet.
 */
export function AppSidebar() {
  const role = useAuthStore((s) => s.user?.role);
  const { pathname } = useLocation();
  const groups = visibleGroups(role);
  // Zgloszenia czekajace na decyzje — admin nie dostaje powiadomien wydzialowych, a dziekanat po
  // przeczytaniu powiadomienia nie widzi, ile jeszcze czeka. Klucz pod "requests" — strona
  // zgloszen odswieza go po kazdej decyzji.
  const planner = role === 'ADMIN' || role === 'DEAN_OFFICE';
  const { data: pendingData } = useQuery({
    queryKey: ['requests', 'pending-count'],
    queryFn: fetchPendingRequests,
    enabled: planner,
    refetchInterval: 60_000,
  });
  const pending = pendingData?.pending ?? 0;
  const { isMobile, setOpenMobile, state } = useSidebar();

  // Na mobile panel to wysuwany Sheet — po wyborze pozycji zamykamy go,
  // zeby nie zaslanial tresci. Na desktopie no-op (Sheet nie jest widoczny).
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/" onClick={closeOnMobile}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <CalendarRange className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-heading font-semibold">Planista</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  // "/" tylko dokladnie, reszta po prefiksie (podstrony planu zostaja podswietlone).
                  const isActive =
                    item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        {/* Dymek natywny tylko przy zwinietym menu — rozwiniete pokazuje nazwe. */}
                        <NavLink
                          to={item.to}
                          onClick={closeOnMobile}
                          title={state === 'collapsed' && !isMobile ? item.label : undefined}
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      {item.to === '/requests' && planner && !!pending && (
                        <SidebarMenuBadge
                          className="bg-amber-500/20 text-amber-700 dark:text-amber-300"
                          title={`${plural(pending, 'zgloszenie czeka', 'zgloszenia czekaja', 'zgloszen czeka')} na decyzje`}
                        >
                          {pending > 99 ? '99+' : pending}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>

      {/* Cienki uchwyt przy krawedzi — zwija/rozwija panel myszka. */}
      <SidebarRail />
    </Sidebar>
  );
}
