import * as React from "react"

// Prog zwijania sidebara w hamburger (wysuwany Sheet). 1440 obejmuje tablety
// poziomo (iPad Pro 1366) i laptopy 1366px — staly panel dopiero na wiekszych ekranach.
const MOBILE_BREAKPOINT = 1440

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
