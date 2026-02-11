import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const baseClasses =
  "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40";

const variants: Record<Variant, string> = {
  primary: "bg-white text-black hover:bg-zinc-200",
  secondary: "border border-zinc-800 text-white hover:bg-white/10",
  ghost: "text-white hover:bg-white/10"
};

export default function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${baseClasses} ${variants[variant]} ${className}`.trim()}
      {...props}
    />
  );
}
