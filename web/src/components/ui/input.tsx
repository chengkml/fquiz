import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type = "text", ...props }, ref) => {
    return <input ref={ref} type={type} className={cn("control", className)} {...props} />;
  },
);

Input.displayName = "Input";

export { Input };
