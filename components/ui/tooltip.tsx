"use client";

import type { ComponentProps } from "react";
import { Tooltip as Primitive } from "radix-ui";
import styles from "./feedback.module.css";

export const TooltipProvider = Primitive.Provider;
export const Tooltip = Primitive.Root;
export const TooltipTrigger = Primitive.Trigger;

export function TooltipContent({ className, sideOffset = 4, children, ...props }:
  ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content {...props} sideOffset={sideOffset}
    className={[styles.tooltip, className].filter(Boolean).join(" ")}>
    {children}<Primitive.Arrow className={styles.tooltipArrow} />
  </Primitive.Content></Primitive.Portal>;
}
