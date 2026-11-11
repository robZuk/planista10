import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import App from './App';
import { initSentry, Sentry } from './lib/sentry';
import { createServerWatch } from './lib/serverStatus';
import { installPolishZodErrors } from './lib/zodErrors';
import './index.css';

// Error-tracking startujemy przed renderem (no-op gdy brak VITE_SENTRY_DSN).
initSentry();
// Komunikaty walidacji formularzy bez wlasnego tekstu — po polsku zamiast domyslnych angielskich.
installPolishZodErrors();

/**
 * Jeden klient React Query na cala aplikacje.
 * retry: 1 — przy bledzie 4xx nie ma sensu ponawiac w nieskonczonosc.
 */
// Brak polaczenia z serwerem: jeden komunikat i ponawianie (lib/serverStatus).
const serverWatch = createServerWatch(() => queryClient);
const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: serverWatch.onError, onSuccess: serverWatch.onSuccess }),
  mutationCache: new MutationCache({ onError: serverWatch.onError }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById('root')!, {
  // Bledy renderu React (React 19) trafiaja do error-trackingu (no-op gdy wylaczone).
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    {/* attribute="class" -> next-themes dopisuje klase .dark do <html>, czego oczekuje Tailwind */}
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <Toaster position="bottom-right" richColors />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
