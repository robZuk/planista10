import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          // Komunikaty z backendu bywaja wielowierszowe (np. lista kolizji) — zachowaj nowe linie i wciecia.
          title: "whitespace-pre-wrap",
          // Akcje komunikatow wygladaja jak przyciski aplikacji (domyslnie sonner daje maly, jasny przycisk).
          actionButton: "!h-7 !rounded-md !bg-primary !px-3 !text-xs !font-medium !text-primary-foreground hover:!bg-primary/90",
          cancelButton: "!h-7 !rounded-md !bg-muted !px-3 !text-xs !font-medium !text-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
