import { useEffect, useRef, useState } from 'preact/hooks';

/** Width of a container element, kept current with a ResizeObserver. */
export function useWidth<T extends HTMLElement>(fallback = 360) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
