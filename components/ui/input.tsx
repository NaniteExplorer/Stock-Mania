import * as React from "react";
import { cn } from "../../lib/utils";
import styles from "./controls.module.css";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input {...props} type={type} data-slot="input" className={cn(styles.input, className)} />;
}

export { Input };
