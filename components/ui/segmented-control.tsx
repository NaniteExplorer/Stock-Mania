"use client";

import * as React from "react";
import { cn } from "../../lib/utils";
import styles from "./controls.module.css";

type Segment = { value: string; label: React.ReactNode; disabled?: boolean };
type SegmentedControlProps = Omit<React.ComponentProps<"div">, "onChange" | "defaultValue"> & {
  options: readonly Segment[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  variant?: "raised" | "flush";
  size?: "default" | "sm";
};

/** A group of native toggle buttons; Tab/Space/Enter retain browser semantics. */
function SegmentedControl({ options, value, onValueChange, disabled = false,
  variant = "raised", size = "default", className, ...props }: SegmentedControlProps) {
  return <div {...props} role="group" data-slot="segmented-control" data-variant={variant}
    data-size={size} className={cn(styles.segmented, className)}>
    {options.map((option) => <button key={option.value} type="button" disabled={disabled || option.disabled}
      aria-pressed={value === option.value} onClick={() => onValueChange(option.value)}>{option.label}</button>)}
  </div>;
}

export { SegmentedControl, type SegmentedControlProps, type Segment };
