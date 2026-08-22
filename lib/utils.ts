import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind class merging, and nothing else.
 *
 * v1's version also held every money and date formatter in the app, all of them
 * taking `number`. Those are gone: money formatting lives in `src/ui/format.ts`
 * and takes `Money`, so an inexact figure has no path to the screen. The news,
 * market-cap and article helpers went with the features that used them.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
