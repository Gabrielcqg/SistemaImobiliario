import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {}

export default function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-zinc-800 bg-white/5 p-6 shadow-glow backdrop-blur-md ${className}`.trim()}
      {...props}
    />
  );
}
