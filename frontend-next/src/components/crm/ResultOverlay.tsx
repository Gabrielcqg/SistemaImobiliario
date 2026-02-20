"use client";

import { motion } from "framer-motion";

type ResultOverlayProps = {
  type: "won" | "lost";
};

export default function ResultOverlay({ type }: ResultOverlayProps) {
  const isWon = type === "won";

  return (
    <motion.div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/85"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="pointer-events-none flex flex-col items-center justify-center gap-3 text-center"
        initial={{ opacity: 0, scale: 0.86 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
      >
        <div className="text-7xl font-black leading-none text-white">
          {isWon ? "✅" : "X"}
        </div>
        <p className="text-3xl font-semibold uppercase tracking-[0.3em] text-white">
          {isWon ? "+1" : "Perdido"}
        </p>
      </motion.div>
    </motion.div>
  );
}
