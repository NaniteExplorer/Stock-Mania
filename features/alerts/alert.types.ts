export type AlertType = "PRICE_ABOVE" | "PRICE_BELOW";
export type AlertChannel = "EMAIL" | "WHATSAPP" | "BOTH";
export type AlertStatus = "ACTIVE" | "TRIGGERED" | "CANCELLED";

export interface PriceAlert {
  id: string;
  userId: string;
  symbol: string;
  type: AlertType;
  targetPrice: number;
  channel: AlertChannel;
  whatsappNumber: string | null;
  status: AlertStatus;
  triggeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAlertInput {
  symbol: string;
  type: AlertType;
  targetPrice: number;
  channel: AlertChannel;
  whatsappNumber?: string;
}
