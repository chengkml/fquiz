import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return <textarea ref={ref} className={cn("control min-h-24", className)} {...props} />;
  },
);

Textarea.displayName = "Textarea";

export { Textarea };
