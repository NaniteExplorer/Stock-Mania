import * as React from "react";
import { cn } from "../../lib/utils";
import { Icon } from "../icons";
import styles from "./controls.module.css";

type ChipProps = Omit<React.ComponentProps<"button">, "children" | "onClick"> & {
  children: string;
  onRemove: React.MouseEventHandler<HTMLButtonElement>;
};

/** The entire chip is the dismiss target; its small X is decoration, never a button. */
function Chip({ children, onRemove, className, ...props }: ChipProps) {
  return <button {...props} type="button" onClick={onRemove} data-slot="chip"
    aria-label={props["aria-label"] ?? `Remove ${children}`} className={cn(styles.chip, className)}>
    <span>{children}</span><Icon name="x" size={16} className={styles.chipDismiss} />
  </button>;
}

export { Chip, type ChipProps };
