import { Download, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { PlanPdfPreview } from '@/hooks/usePlanPdf';

/**
 * Podglad druku planu w oknie aplikacji — przegladarkowa przegladarka PDF (przewijanie stron,
 * powiekszenie, drukowanie z jej paska) i pobranie pliku pod nazwa z backendu.
 */
export function PlanPdfDialog({ preview, onClose }: { preview: PlanPdfPreview | null; onClose: () => void }) {
  return (
    <Dialog open={!!preview} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] flex-col gap-3 sm:max-w-[min(1200px,calc(100%-2rem))]">
        {preview && (
          <>
            <DialogHeader className="pr-8">
              <DialogTitle>{preview.title}</DialogTitle>
              <DialogDescription>Podglad wydruku (A4 poziomo). Drukowac mozna z paska podgladu albo po pobraniu pliku.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <a href={preview.url} download={preview.fileName}>
                  <Download /> Pobierz PDF
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={preview.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Otworz w nowej karcie
                </a>
              </Button>
              <span className="self-center text-xs text-muted-foreground">{preview.fileName}</span>
            </div>
            <iframe title={preview.title} src={preview.url} className="min-h-0 w-full flex-1 rounded-md border bg-muted" />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
