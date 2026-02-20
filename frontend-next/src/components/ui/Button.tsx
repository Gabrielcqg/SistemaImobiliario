import type { ButtonHTMLAttributes } from "react";
import LedButton from "./LedButton";

type Variant = "primary" | "secondary" | "ghost" | "cta";
type Size = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
}

/**
 * Standardized Button component.
 * Wraps LedButton with the new interaction-based design system.
 */
export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  isLoading,
  ...props
}: ButtonProps) {

  // Mapping legacy/standard names to LedButton variants
  let ledVariant: "solid" | "ghost" | "subtle" | "cta" = "solid";

  if (variant === "primary") ledVariant = "solid"; // Default solid dark button
  if (variant === "secondary") ledVariant = "subtle";
  if (variant === "ghost") ledVariant = "ghost";
  if (variant === "cta") ledVariant = "cta"; // New high-emphasis variant

  return (
    <LedButton
      size={size}
      variant={ledVariant}
      className={className}
      isLoading={isLoading}
      {...props}
    >
      {children}
    </LedButton>
  );
}
