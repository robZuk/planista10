import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '@/api/notifications';
import { timeAgo } from '@/lib/requestLabels';
import { cn } from '@/lib/utils';
import type { AppNotification } from '@/types';
import { plural } from '@/lib/setupSteps';

/**
 * Dzwonek powiadomien w naglowku: zgloszenia zmian (dziekanat) i decyzje / zmiany terminow
 * (prowadzacy). Licznik odswieza sie co minute; klikniecie oznacza jako przeczytane i otwiera
 * strone, ktorej dotyczy powiadomienie.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications, refetchInterval: 60_000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const readOne = useMutation({ mutationFn: markNotificationRead, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh });
  const unread = data?.unread ?? 0;

  const openItem = (n: AppNotification) => {
    if (!n.readAt) readOne.mutate(n.id);
    setOpen(false);
    if (n.link) {
      navigate(n.link);
      // Strona docelowa moze juz byc otwarta — odswiez jej dane (zgloszenia, plan).
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
      void queryClient.invalidateQueries({ queryKey: ['makeups'] });
      void queryClient.invalidateQueries({ queryKey: ['my-plan'] });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Powiadomienia (${plural(unread, 'nowe', 'nowe', 'nowych')})` : 'Powiadomienia'}>
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Powiadomienia</span>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
              <CheckCheck /> Oznacz wszystkie
            </Button>
          )}
        </div>
        <ul className="max-h-[60vh] divide-y overflow-y-auto">
          {(data?.items ?? []).length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Brak powiadomien.</li>}
          {(data?.items ?? []).map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => openItem(n)}
                className={cn('flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted', !n.readAt && 'bg-primary/5')}
              >
                <span className="flex items-center gap-2 font-medium">
                  {!n.readAt && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="nowe" />}
                  {n.title}
                </span>
                <span className="text-xs text-muted-foreground">{n.body}</span>
                <span className="text-[11px] text-muted-foreground/80">{timeAgo(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
