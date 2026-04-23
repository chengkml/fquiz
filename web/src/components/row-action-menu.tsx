"use client";

import type { ComponentProps } from "react";
import { Button, DropdownMenu } from "@/components/ui-antd";

type RowActionMenuColor = ComponentProps<typeof DropdownMenu.Item>["color"];

export type RowActionMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  color?: RowActionMenuColor;
};

type RowActionMenuProps = {
  items: RowActionMenuItem[];
  triggerLabel?: string;
  align?: "start" | "center" | "end";
};

export function RowActionMenu({
  items,
  triggerLabel = "操作",
  align = "end",
}: RowActionMenuProps) {
  if (items.length === 0) {
    return <span className="text-xs text-[var(--gray-11)]">-</span>;
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button type="button" color="gray" size="1" variant="soft">
          {triggerLabel}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align={align} size="2" variant="soft">
        {items.map((item) => (
          <DropdownMenu.Item
            key={item.key}
            color={item.color ?? "gray"}
            disabled={item.disabled}
            onSelect={() => {
              if (!item.disabled) {
                item.onSelect();
              }
            }}
          >
            {item.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
