import { useEffect, useState } from "react";

/** Keep the visible image until its replacement is decoded; discard stale selections. */
export function useShareCardPreview(src: string, enabled = true) {
  const [preview, setPreview] = useState<{ src: string | null; failedSrc: string | null }>({ src: enabled ? src : null, failedSrc: null });
  useEffect(() => {
    if (!enabled || preview.src === src) return;
    let disposed = false;
    const image = new Image();
    const ready = () => { if (!disposed) setPreview({ src, failedSrc: null }); };
    const failed = () => { if (!disposed) setPreview((previous) => ({ ...previous, failedSrc: src })); };
    image.src = src;
    if (typeof image.decode === "function") {
      void image.decode().then(ready, failed);
    } else {
      image.onload = ready;
      image.onerror = failed;
      if (image.complete && image.naturalWidth > 0) ready();
    }
    return () => { disposed = true; image.onload = null; image.onerror = null; };
  }, [src, enabled, preview.src]);
  return { src: preview.src, pending: !enabled || preview.src !== src, failed: preview.failedSrc === src };
}
