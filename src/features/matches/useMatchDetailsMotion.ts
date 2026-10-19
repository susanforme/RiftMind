import { startTransition, useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useMatchDetailsMotion(open: boolean, keepMounted = false) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (open || !keepMounted || mounted) return;
    const prepare = () => startTransition(() => setMounted(true));
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(prepare, { timeout: 1000 });
      return () => window.cancelIdleCallback(idle);
    }
    const timeout = setTimeout(prepare, 200);
    return () => clearTimeout(timeout);
  }, [open, keepMounted, mounted]);

  useLayoutEffect(() => {
    if (!open) return;
    setMounted(true);
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setHeight(content.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (open || keepMounted || !mounted) return;
    const timeout = setTimeout(() => setMounted(false), 250);
    return () => clearTimeout(timeout);
  }, [open, mounted, keepMounted]);

  return { contentRef, mounted: open || mounted, height: open ? height : 0 };
}
