import * as React from "react";

/** Canonical hand-authored geometry from Control Bench; never vendor logos. */
const SHAPES = {
  "grid": <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></>,
  "clock": <><circle cx="8" cy="8" r="5.5"/><path d="M8 4.8V8l2.4 1.4"/></>,
  "bank": <><path d="M2 6.5 8 2.6l6 3.9"/><path d="M4.5 7.5v4.5M8 7.5v4.5M11.5 7.5v4.5"/><path d="M2 13.5h12"/></>,
  "list": <><path d="M3 4.5h10M3 8h10M3 11.5h6.5"/></>,
  "rows": <><rect x="2.5" y="3" width="11" height="3" rx="1"/><rect x="2.5" y="10" width="11" height="3" rx="1"/></>,
  "wallet": <><rect x="2" y="4" width="12" height="8.5" rx="1.6"/><path d="M2 6.6h12"/><circle cx="11.2" cy="9.6" r=".85" fill="currentColor" stroke="none"/></>,
  "upload": <><path d="M8 10.5V3.2M5.4 5.8 8 3.2l2.6 2.6"/><path d="M2.8 10.8v2.2h10.4v-2.2"/></>,
  "chart-line": <><path d="M2.5 12.2 6 8.4l2.6 2.1L13.5 4"/><path d="M10.9 4h2.6v2.6"/></>,
  "trend": <><path d="M2.5 11.6 6.2 7l2.6 2.4 4.7-5.2"/><path d="M11 4.2h2.5v2.5"/></>,
  "building": <><rect x="3" y="2.5" width="10" height="11" rx="1.2"/><path d="M5.6 5.4h1.6M8.8 5.4h1.6M5.6 8h1.6M8.8 8h1.6"/><path d="M6.6 13.5v-2.6h2.8v2.6"/></>,
  "signal": <><path d="M3 12.4V9.6M6.3 12.4V6.2M9.7 12.4V8.4M13 12.4V3.6"/></>,
  "vault": <><rect x="2.5" y="2.8" width="11" height="10.4" rx="1.4"/><circle cx="8" cy="8" r="2.6"/><path d="M8 3.9v1.5M8 10.6v1.5"/></>,
  "gem": <><path d="M4.6 3.2h6.8L14 6.6 8 13.1 2 6.6z"/><path d="M2 6.6h12"/></>,
  "card": <><rect x="2" y="3.8" width="12" height="8.4" rx="1.4"/><path d="M2 6.7h12"/></>,
  "loan": <><rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.3"/><path d="M4.6 11.2h2.4V8.8h2.6V6.2h3"/></>,
  "gear": <><circle cx="8" cy="8" r="2.4"/><path d="M8 2.2v1.6M8 12.2v1.6M13.8 8h-1.6M3.8 8H2.2M12.1 3.9l-1.1 1.1M5 11l-1.1 1.1M12.1 12.1 11 11M5 5 3.9 3.9"/></>,
  "sort-asc": <><path d="M5.5 6.8 8 4.3l2.5 2.5"/><path d="M5.5 9.2 8 11.7l2.5-2.5" opacity=".3"/></>,
  "sort-desc": <><path d="M5.5 6.8 8 4.3l2.5 2.5" opacity=".3"/><path d="M5.5 9.2 8 11.7l2.5-2.5"/></>,
  "sort-none": <><path d="M5.5 6.8 8 4.3l2.5 2.5" opacity=".35"/><path d="M5.5 9.2 8 11.7l2.5-2.5" opacity=".35"/></>,
  "filter": <><path d="M2.6 3.9h10.8l-4.2 5v4.2l-2.4-1.3V8.9z"/></>,
  "columns": <><rect x="2.3" y="3" width="11.4" height="10" rx="1.2"/><path d="M6.1 3v10M9.9 3v10"/></>,
  "density": <><path d="M3 3.8h10M3 6.6h10M3 9.4h10M3 12.2h10"/></>,
  "download": <><path d="M8 3.2v7.3M5.4 7.9 8 10.5l2.6-2.6"/><path d="M2.8 10.8v2.2h10.4v-2.2"/></>,
  "expand": <><path d="M9.6 2.8h3.6v3.6M13.2 2.8 9.9 6.1"/><path d="M6.4 13.2H2.8V9.6M2.8 13.2 6.1 9.9"/></>,
  "search": <><circle cx="7.1" cy="7.1" r="4.3"/><path d="M10.3 10.3 13.4 13.4"/></>,
  "plus": <><path d="M8 3.4v9.2M3.4 8h9.2"/></>,
  "edit": <><path d="M10.4 2.9 13.1 5.6 5.7 13H3v-2.7z"/><path d="M9.1 4.2 11.8 6.9"/></>,
  "trash": <><path d="M2.9 4.4h10.2"/><path d="M4.4 4.4V3.1h7.2v1.3"/><path d="M4.1 4.4 4.7 13h6.6l.6-8.6"/><path d="M6.7 6.8v3.8M9.3 6.8v3.8"/></>,
  "refresh": <><path d="M12.6 6.6A4.9 4.9 0 1 0 13 9.4"/><path d="M13.2 3.2v3.4h-3.4"/></>,
  "info": <><circle cx="8" cy="8" r="5.5"/><path d="M8 7.3v3.6"/><circle cx="8" cy="5.3" r=".75" fill="currentColor" stroke="none"/></>,
  "warn": <><path d="M8 2.6 14 13H2z"/><path d="M8 6.6v3"/><circle cx="8" cy="11.2" r=".75" fill="currentColor" stroke="none"/></>,
  "external": <><path d="M12.4 9.1v3.1a1.2 1.2 0 0 1-1.2 1.2H3.8a1.2 1.2 0 0 1-1.2-1.2V4.8a1.2 1.2 0 0 1 1.2-1.2h3.1"/><path d="M9.8 2.7h3.5v3.5M13.3 2.7 7.6 8.4"/></>,
  "check": <><path d="M3.2 8.4 6.4 11.6 12.8 4.8"/></>,
  "ck": <><path d="M3.4 8.3 6.3 11.2 12.6 4.9"/></>,
  "ix": <><path d="M4.2 8h7.6"/></>,
  "chev-d": <><path d="M4.4 6.3 8 9.9l3.6-3.6"/></>,
  "chev-u": <><path d="M4.4 9.7 8 6.1l3.6 3.6"/></>,
  "chev-l": <><path d="M9.7 4.4 6.1 8l3.6 3.6"/></>,
  "chev-r": <><path d="M6.3 4.4 9.9 8l-3.6 3.6"/></>,
  "caret-u": <><path d="M4 9.6 8 5.6l4 4"/></>,
  "caret-d": <><path d="M4 6.4 8 10.4l4-4"/></>,
  "arrow-r": <><path d="M3 8h10M9.4 4.4 13 8l-3.6 3.6"/></>,
  "more": <><circle cx="3.6" cy="8" r=".95" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".95" fill="currentColor" stroke="none"/><circle cx="12.4" cy="8" r=".95" fill="currentColor" stroke="none"/></>,
  "x": <><path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8"/></>,
  "copy": <><rect x="5.4" y="5.4" width="7.8" height="7.8" rx="1.2"/><path d="M10.6 5.4V4a1.2 1.2 0 0 0-1.2-1.2H4a1.2 1.2 0 0 0-1.2 1.2v5.4a1.2 1.2 0 0 0 1.2 1.2h1.4"/></>,
  "calendar": <><rect x="2.4" y="3.5" width="11.2" height="10.1" rx="1.3"/><path d="M2.4 6.5h11.2"/><path d="M5.5 2.3v2.3M10.5 2.3v2.3"/></>,
  "equity": <><path d="M8 2.6v10.8"/><path d="M8 5.6H5.1M8 10.4h2.9"/></>,
  "etf": <><rect x="2.3" y="2.9" width="11.4" height="10.2" rx="1.3"/><path d="M5.6 10.6V7.4M8 10.6V5.4M10.4 10.6V8.6"/></>,
  "mutual-fund": <><path d="M5.1 9.9V6.4M8 9.9V4.3M10.9 9.9V7.5"/><path d="M3.4 12.3h9.2"/></>,
  "gold": <><path d="M2.6 11.4 4.4 6.3h7.2l1.8 5.1z"/><path d="M4.4 8.6h7.2"/></>,
  "silver": <><path d="M3.1 13.2 4.3 10h7.4l1.2 3.2z"/><path d="M4.6 8.1 5.5 5.4h5l.9 2.7z"/></>,
  "bond": <><rect x="2.3" y="3.2" width="11.4" height="9.6" rx="1.2"/><path d="M4.7 6.2h5M4.7 8.4h3.2"/><circle cx="11" cy="9.8" r="1.7"/></>,
  "fd": <><rect x="2.6" y="3.1" width="10.8" height="9.8" rx="1.5"/><circle cx="8" cy="8" r="2.8"/><path d="M8 6.3V8l1.4.9"/></>,
  "cash": <><rect x="1.9" y="4.2" width="12.2" height="7.6" rx="1.2"/><circle cx="8" cy="8" r="1.9"/><path d="M4.3 6.3v0M11.7 9.7v0"/><path d="M4.1 6.5h.4M11.5 9.5h.4"/></>,
  "property": <><path d="M2 7.6 8 2.6l6 5"/><path d="M3.6 7.1v6.3h8.8V7.1"/><path d="M6.6 13.4V9.9h2.8v3.5"/></>,
} satisfies Record<string, React.ReactNode>;

export type IconName = keyof typeof SHAPES;
export const ICON_NAMES: readonly IconName[] = Object.freeze(Object.keys(SHAPES) as IconName[]);

type FixedAttributes = "children" | "dangerouslySetInnerHTML" | "width" | "height" |
  "viewBox" | "fill" | "stroke" | "strokeWidth" | "strokeLinecap" | "strokeLinejoin" |
  "role" | "aria-hidden" | "aria-label" | "focusable";

export interface IconProps extends Omit<React.ComponentPropsWithoutRef<"svg">, FixedAttributes> {
  readonly name: IconName;
  readonly size?: 14 | 16 | 20;
  /** Supply only when the icon itself conveys meaning; otherwise label its control. */
  readonly label?: string;
}

/** Decorative by default. Optical weight is fixed at every supported size. */
export function Icon({ name, size = 16, label, ...props }: IconProps) {
  const accessibleLabel = label?.trim() || undefined;
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={accessibleLabel ? "img" : undefined}
      aria-hidden={accessibleLabel ? undefined : true}
      aria-label={accessibleLabel}
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
