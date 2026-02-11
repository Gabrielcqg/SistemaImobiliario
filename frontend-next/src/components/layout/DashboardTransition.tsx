"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const transition = {
  duration: 0.25,
  ease: [0.22, 1, 0.36, 1]
};

const variants = {
  initial: {
    opacity: 0,
    y: 12
  },
  animate: {
    opacity: 1,
    y: 0,
    transition
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: { ...transition, duration: 0.2 }
  }
};

export default function DashboardTransition({
  children
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const renderCountRef = useRef(0);

  renderCountRef.current += 1;

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const perf = (window as unknown as { __navPerf?: { start: number; href: string } })
      .__navPerf;
    if (!perf) return;

    const start = perf.start;
    const target = perf.href;
    requestAnimationFrame(() => {
      const duration = performance.now() - start;
      console.log("[NavPerf]", {
        target,
        pathname,
        durationMs: Math.round(duration),
        rendersDuringNav: renderCountRef.current
      });
      renderCountRef.current = 0;
    });
  }, [pathname]);

  return (
    <div className="relative h-full bg-black">
      <AnimatePresence mode="sync" initial={false}>
        <motion.div
          key={pathname}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="h-full will-change-[transform,opacity]"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
