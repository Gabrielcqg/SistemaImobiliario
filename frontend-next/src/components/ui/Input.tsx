import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export default function Input({ className = "", ...props }: InputProps) {
  return (
    <input
      className={`w-full rounded-lg px-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none accent-focus accent-control ${className}`.trim()}
      {...props}
    />
  );
}
