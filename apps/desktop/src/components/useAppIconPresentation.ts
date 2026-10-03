import { useEffect, useState } from "react";
import { calibratedAppIcon } from "./appIconPresentation";

export function useAppIconPresentation(source: string | null | undefined): string | null | undefined {
  const [resolved, setResolved] = useState<{ source: string; value: string } | null>(null);
  useEffect(() => {
    if (!source) return;
    let active = true;
    void calibratedAppIcon(source).then(value => {
      if (active && value !== source) setResolved({ source, value });
    });
    return () => { active = false; };
  }, [source]);
  return resolved && resolved.source === source ? resolved.value : source;
}
