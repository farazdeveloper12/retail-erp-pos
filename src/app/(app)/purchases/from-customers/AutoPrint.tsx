"use client";

import { useEffect, useRef } from "react";

// Opens the print dialog once, right after a slip was saved (?print=1)
export default function AutoPrint({ enabled }: { enabled: boolean }) {
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || done.current) return;
    done.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [enabled]);
  return null;
}
