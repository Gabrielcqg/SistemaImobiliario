import type { ButtonHTMLAttributes, ReactNode } from "react";

interface LedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    size?: "sm" | "md" | "lg" | "icon";
    variant?: "solid" | "ghost" | "subtle" | "cta";
    children: ReactNode;
    isLoading?: boolean;
    className?: string; // Explicitly included for clarity
}

export default function LedButton({
    size = "md",
    variant = "solid",
    className = "",
    isLoading = false,
    children,
    disabled,
    ...props
}: LedButtonProps) {
    // Map sizes to CSS classes defined in globals.css
    const sizeClass = `btn-${size}`;

    // Map variant to base class + interaction modifier
    // All variants get 'btn-led-interaction' to enable the hover glow effect
    // unless we want some to be totally flat. Global requirement says "transform LED into interaction affordance".

    let variantClass = "btn-solid"; // Default
    if (variant === "ghost") variantClass = "btn-ghost";
    if (variant === "subtle") variantClass = "btn-ghost opacity-80 hover:opacity-100";
    if (variant === "cta") variantClass = "btn-cta";

    return (
        <button
            className={`btn ${sizeClass} ${variantClass} btn-led-interaction ${className}`}
            disabled={disabled || isLoading}
            {...props}
        >
            {isLoading ? (
                <span className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            ) : null}
            {children}
        </button>
    );
}
