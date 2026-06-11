"use client";

import { Select } from "antd";

type CreatableSingleSelectProps = {
  allowClear?: boolean;
  disabled?: boolean;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
  value?: string | null;
  onChange?: (value: string) => void;
};

export function CreatableSingleSelect({
  allowClear = true,
  disabled,
  options,
  placeholder,
  value,
  onChange,
}: CreatableSingleSelectProps) {
  return (
    <Select
      allowClear={allowClear}
      disabled={disabled}
      mode="tags"
      maxCount={1}
      options={options}
      placeholder={placeholder}
      value={value ? [value] : []}
      onChange={(nextValue) => onChange?.(Array.isArray(nextValue) ? (nextValue.at(-1) ?? "") : "")}
    />
  );
}
