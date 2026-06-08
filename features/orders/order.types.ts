export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";
export type OrderStatus =
  | "PENDING"
  | "PLACED"
  | "COMPLETE"
  | "CANCELLED"
  | "REJECTED";
export type OrderProduct = "CNC" | "MIS" | "NRML";
export type OrderExchange = "NSE" | "BSE" | "NFO" | "MCX" | "NYSE" | "NASDAQ" | "ARCA";
export type OrderBroker = "ZERODHA" | "ALPACA";

export const US_EXCHANGES: OrderExchange[] = ["NYSE", "NASDAQ", "ARCA"];
export const IN_EXCHANGES: OrderExchange[] = ["NSE", "BSE", "NFO", "MCX"];

export function isUSExchange(exchange: OrderExchange): boolean {
  return (US_EXCHANGES as string[]).includes(exchange);
}

export interface TradeOrder {
  id: string;
  userId: string;
  symbol: string;
  exchange: OrderExchange;
  broker: OrderBroker;
  side: OrderSide;
  orderType: OrderType;
  product: OrderProduct;
  quantity: number;
  price: number | null;
  status: OrderStatus;
  brokerId: string | null;
  errorMessage: string | null;
  placedAt: Date;
  updatedAt: Date;
}

export interface PlaceOrderInput {
  symbol: string;
  exchange: OrderExchange;
  side: OrderSide;
  orderType: OrderType;
  product: OrderProduct;
  quantity: number;
  price?: number;
}
