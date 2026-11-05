"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "../../lib/utils";
import styles from "./controls.module.css";

const buttonVariants = cva(styles.button, {
  variants: {
    variant: {
      default: styles.primary, outline: styles.outline, secondary: styles.outline,
      ghost: styles.ghost, destructive: styles.danger, link: styles.link,
    },
    size: {
      default: styles.medium, xs: styles.extraSmall, sm: styles.small, lg: styles.large,
      icon: cn(styles.medium, styles.icon), "icon-xs": cn(styles.extraSmall, styles.icon),
      "icon-sm": cn(styles.small, styles.icon), "icon-lg": cn(styles.large, styles.icon),
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & {
  asChild?: boolean;
  /** Retains the label's layout and accessible name while work is in flight. */
  loading?: boolean;
};

function Button({ className, variant = "default", size = "default", asChild = false,
  loading = false, disabled, children, onClick, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const unavailable = disabled || loading || props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const labelId = React.useId();
  const label = <span id={labelId} className={styles.buttonLabel}>{asChild && React.isValidElement<{ children?: React.ReactNode }>(children) ? children.props.children : children}</span>;
  const content = asChild && React.isValidElement<{ children?: React.ReactNode; onClick?: React.MouseEventHandler }>(children)
    ? React.cloneElement(children, unavailable ? { onClick: undefined } : {}, label) : label;
  return <Comp {...props} data-slot="button" data-variant={variant} data-size={size}
    data-loading={loading || undefined} aria-busy={loading || undefined}
    aria-disabled={unavailable || props["aria-disabled"]}
    aria-labelledby={props["aria-labelledby"] ?? (loading && !props["aria-label"] ? labelId : undefined)}
    disabled={asChild ? undefined : unavailable}
    tabIndex={asChild && unavailable ? -1 : props.tabIndex}
    onClick={asChild && unavailable ? (event) => event.preventDefault() : onClick}
    className={cn(buttonVariants({ variant, size, className }))}>
    {content}
  </Comp>;
}

export { Button, buttonVariants, type ButtonProps };
