"use client";

import { useEffect, useState } from "react";

export interface LiveQuote {
  c: number;  // current price
  d: number;  // change
  dp: number; // percent change
  h: number;  // day high
  l: number;  // day low
  t: number;  // timestamp
}

export function usePriceStream(symbol: string) {
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!symbol) return;

    const es = new EventSource(`/api/prices/${symbol}`);

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        setQuote(JSON.parse(e.data) as LiveQuote);
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [symbol]);

  return { quote, connected };
}
