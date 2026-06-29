export interface Quote {
  /** Price in the instrument's native currency. */
  price: number;
  currency: string;
}

export interface RefreshResult {
  updated: number;
  failed: number;
  skipped: number;
}
