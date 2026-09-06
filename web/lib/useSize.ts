"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Measures an element so charts can be drawn in real pixels. Drawing them in
 *  a scaled viewBox instead would shrink axis labels on narrow screens, which
 *  is exactly where they most need to stay legible.
 *
 *  The ref is a callback rather than an object ref on purpose: a chart that
 *  renders its "nothing recorded yet" message first has no element to measure
 *  on mount, and a mount-only effect would then never observe the element that
 *  appears when the data arrives — leaving the chart pinned at its fallback
 *  width for the life of the page. */
export function useSize<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;

    // ResizeObserver is unavailable in jsdom and in older browsers; fall back
    // to a one-shot measurement so the chart still renders at a sane size
    // rather than collapsing to zero width.
    if (typeof ResizeObserver === "undefined") {
      setWidth(node.clientWidth);
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { ref, width };
}
