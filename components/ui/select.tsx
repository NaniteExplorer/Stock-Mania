"use client";

import * as React from "react";
import { Select as Primitive } from "radix-ui";
import { cn } from "../../lib/utils";
import { Icon } from "../icons";
import styles from "./controls.module.css";

function Select(props: React.ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root {...props} data-slot="select" />;
}
function SelectGroup({ className, ...props }: React.ComponentProps<typeof Primitive.Group>) {
  return <Primitive.Group {...props} data-slot="select-group" className={cn(styles.selectGroup, className)} />;
}
function SelectValue(props: React.ComponentProps<typeof Primitive.Value>) {
  return <Primitive.Value {...props} data-slot="select-value" />;
}
function SelectTrigger({ className, size = "default", children, ...props }: React.ComponentProps<typeof Primitive.Trigger> & { size?: "sm" | "default" }) {
  return <Primitive.Trigger {...props} data-slot="select-trigger" data-size={size} className={cn(styles.selectTrigger, className)}>
    {children}<Primitive.Icon asChild><Icon name="chev-d" /></Primitive.Icon>
  </Primitive.Trigger>;
}
function SelectContent({ className, children, position = "item-aligned", align = "center", ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content {...props} data-slot="select-content" position={position} align={align} className={cn(styles.selectContent, className)}>
    <SelectScrollUpButton /><Primitive.Viewport>{children}</Primitive.Viewport><SelectScrollDownButton />
  </Primitive.Content></Primitive.Portal>;
}
function SelectLabel({ className, ...props }: React.ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label {...props} data-slot="select-label" className={cn(styles.selectLabel, className)} />;
}
function SelectItem({ className, children, ...props }: React.ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item {...props} data-slot="select-item" className={cn(styles.selectItem, className)}>
    <Primitive.ItemText>{children}</Primitive.ItemText><span className={styles.selectIndicator}><Primitive.ItemIndicator><Icon name="check" /></Primitive.ItemIndicator></span>
  </Primitive.Item>;
}
function SelectSeparator({ className, ...props }: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator {...props} data-slot="select-separator" className={cn(styles.selectSeparator, className)} />;
}
function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof Primitive.ScrollUpButton>) {
  return <Primitive.ScrollUpButton {...props} data-slot="select-scroll-up-button" className={cn(styles.selectScroll, className)}><Icon name="chev-u" /></Primitive.ScrollUpButton>;
}
function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof Primitive.ScrollDownButton>) {
  return <Primitive.ScrollDownButton {...props} data-slot="select-scroll-down-button" className={cn(styles.selectScroll, className)}><Icon name="chev-d" /></Primitive.ScrollDownButton>;
}
export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue };
