"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { subscribeNavigationStart } from "@/lib/navigation/progress";

export default function RouteProgressBar() {
  const pathname = usePathname();
  const previousPathRef = useRef(pathname);
  const intervalRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  const stopTimers = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopTimers();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeNavigationStart(() => {
      stopTimers();
      setVisible(true);
      setProgress(14);

      intervalRef.current = window.setInterval(() => {
        setProgress((previous) => {
          const next = previous + (100 - previous) * 0.12;
          return Math.min(next, 90);
        });
      }, 120);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (previousPathRef.current === pathname) {
      return;
    }

    previousPathRef.current = pathname;
    stopTimers();
    setVisible(true);
    setProgress(100);

    hideTimeoutRef.current = window.setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 260);
  }, [pathname]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-x-0 top-0 z-[120] h-[2px] transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className="h-full bg-gradient-to-r from-white via-zinc-300 to-white shadow-[0_0_10px_rgba(255,255,255,0.6)] transition-[width] duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
