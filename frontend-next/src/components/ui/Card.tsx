import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {}

export default function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-zinc-800/90 bg-white/[0.045] p-6 shadow-[var(--accent-glow-subtle)] backdrop-blur-md transition-colors ${className}`.trim()}
      {...props}
    />
  );
}
