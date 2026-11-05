import * as React from "react";
import styles from "./data-display.module.css";

const classes = (...values: (string | undefined)[]) => values.filter(Boolean).join(" ");

export function Table({ className, density = "default", ...props }: React.ComponentProps<"table"> & { density?: "default" | "compact" }) {
  return <table data-slot="table" data-density={density} className={classes(styles.table, className)} {...props} />;
}
export function TableHeader(props: React.ComponentProps<"thead">) { return <thead data-slot="table-header" {...props} />; }
export function TableBody(props: React.ComponentProps<"tbody">) { return <tbody data-slot="table-body" {...props} />; }
export function TableFooter(props: React.ComponentProps<"tfoot">) { return <tfoot data-slot="table-footer" {...props} />; }
export function TableRow(props: React.ComponentProps<"tr">) { return <tr data-slot="table-row" {...props} />; }
/** `align="right"` for numeric columns, so the header sits over right-aligned FigureCells. */
export function TableHead({ scope = "col", align, ...props }: Omit<React.ComponentProps<"th">, "align"> & { align?: "left" | "right" }) { return <th data-slot="table-head" data-align={align} scope={scope} {...props} />; }
export function TableCell(props: React.ComponentProps<"td">) { return <td data-slot="table-cell" {...props} />; }
export function TableCaption({ className, ...props }: React.ComponentProps<"caption">) { return <caption data-slot="table-caption" className={classes(styles.caption, className)} {...props} />; }
