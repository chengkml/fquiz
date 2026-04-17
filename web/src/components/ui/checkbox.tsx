import * as React from "react";

import { cn } from "@/lib/utils";

type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange" | "checked" | "defaultChecked"
> & {
  children?: React.ReactNode;
  isSelected?: boolean;
  defaultSelected?: boolean;
  isDisabled?: boolean;
  onChange?: (selected: boolean) => void;
  onValueChange?: (selected: boolean) => void;
};

function Checkbox({
  className,
  children,
  isSelected,
  defaultSelected,
  isDisabled,
  disabled,
  onChange,
  onValueChange,
  ...props
}: CheckboxProps) {
  const resolvedDisabled = isDisabled ?? disabled;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.checked;
    onChange?.(next);
    onValueChange?.(next);
  };

  return (
    <label className={cn("inline-flex items-center gap-2", className)}>
      <input
        {...props}
        checked={isSelected}
        className="checkbox-control"
        defaultChecked={defaultSelected}
        disabled={resolvedDisabled}
        onChange={handleChange}
        type="checkbox"
      />
      {children ? <span>{children}</span> : null}
    </label>
  );
}

export { Checkbox };
export type { CheckboxProps };
