import { Link, useLocation } from 'react-router-dom';
import { MapPinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

/** Nieznany adres w aplikacji — mowimy to wprost, zamiast po cichu przenosic na panel glowny. */
export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MapPinOff />
        </EmptyMedia>
        <EmptyTitle>Nie ma takiej strony</EmptyTitle>
        <EmptyDescription>
          Adres <code className="rounded bg-muted px-1">{pathname}</code> nie prowadzi do zadnej strony systemu. Mogl sie zmienic albo
          zawierac literowke.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link to="/">Przejdz do panelu glownego</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
