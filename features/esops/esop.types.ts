export interface EsopGrant {
  id: string;
  userId: string;
  company: string;
  grantDate: Date;
  totalOptions: number;
  vestedOptions: number;
  strikePrice: number;
  currentFmv: number; // fair market value per share
  createdAt: Date;
  updatedAt: Date;
  // derived (in-the-money values)
  vestedValue: number; // vested * max(fmv - strike, 0)
  totalValue: number; // total * max(fmv - strike, 0)
  vestedPercent: number;
}

export interface CreateEsopInput {
  company: string;
  grantDate: string; // ISO date from form
  totalOptions: number;
  vestedOptions: number;
  strikePrice: number;
  currentFmv: number;
}

export type UpdateEsopInput = Partial<CreateEsopInput>;
