import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, MouseEventHandler } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm transition disabled:cursor-not-allowed disabled:opacity-60",
  {
    variants: {
      variant: {
        default: "btn-primary",
        secondary: "btn-secondary",
        destructive: "btn-danger",
        ghost: "btn-ghost",
      },
      size: {
        default: "px-4 py-2 font-semibold",
        sm: "btn-small px-3 py-1 font-medium",
        lg: "px-6 py-2.5 font-semibold",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> &
  VariantProps<typeof buttonVariants> & {
    onClick?: MouseEventHandler<HTMLButtonElement>;
    onPress?: () => void;
    isDisabled?: boolean;
  };

function Button({
  className,
  variant,
  size,
  onClick,
  onPress,
  isDisabled,
  disabled,
  type,
  ...props
}: ButtonProps) {
  const resolvedDisabled = isDisabled ?? disabled;
  const handleClick = onClick ?? (onPress ? () => onPress() : undefined);

  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={resolvedDisabled}
      onClick={handleClick}
      type={type ?? "button"}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
