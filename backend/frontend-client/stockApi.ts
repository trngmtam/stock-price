/**
 * Stock Prediction API client.
 *
 * Drop this file into your Claude Design prototype (e.g. `src/lib/stockApi.ts`)
 * and call the helpers below from your components.
 *
 * The backend is the FastAPI service in `backend/` (default http://localhost:8000).
 * Override the base URL via the `VITE_API_BASE_URL` env var (or hardcode it).
 */

export const API_BASE_URL =
  // @ts-ignore - import.meta.env exists in Vite projects (Claude Design uses Vite)
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) ||
  "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────

export interface OHLCVRow {
  Date?: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
}

export interface PredictRequest {
  rows: OHLCVRow[]; // oldest-first, >=50 rows recommended
  ticker?: string;
}

export interface NextDayResponse {
  ticker: string | null;
  last_close: number;
  predicted_log_return: number;
  predicted_price: number;
  direction_probability: number;
  direction: "up" | "down";
}

export interface CumulativeResponse {
  ticker: string | null;
  last_close: number;
  horizon_days: number;
  predicted_cumulative_log_return: number;
  predicted_price: number;
  direction_probability: number;
  direction: "up" | "down";
}

export interface MultiStepResponse {
  ticker: string | null;
  last_close: number;
  horizon_days: number;
  predicted_cumulative_log_returns: number[];
  predicted_prices: number[];
  direction_probabilities: number[];
}

export interface SignalResponse {
  ticker: string | null;
  signal: "buy" | "sell";
  probability: number;
  triggered: boolean;
}

export interface HealthResponse {
  status: string;
  models_loaded: string[];
}

// ── Core fetch helper ──────────────────────────────────────────────────────

async function postJSON<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<TRes>;
}

// ── Endpoint wrappers ──────────────────────────────────────────────────────

export const stockApi = {
  health: async (): Promise<HealthResponse> => {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (!res.ok) throw new Error(`health failed: ${res.status}`);
    return res.json();
  },

  predictNextDay: (req: PredictRequest) =>
    postJSON<PredictRequest, NextDayResponse>("/predict/next-day", req),

  predictCumulative7d: (req: PredictRequest) =>
    postJSON<PredictRequest, CumulativeResponse>("/predict/cumulative-7d", req),

  predictMultiStep7d: (req: PredictRequest) =>
    postJSON<PredictRequest, MultiStepResponse>("/predict/multi-step-7d", req),

  predictBuySignal: (req: PredictRequest) =>
    postJSON<PredictRequest, SignalResponse>("/predict/buy-signal", req),

  predictSellSignal: (req: PredictRequest) =>
    postJSON<PredictRequest, SignalResponse>("/predict/sell-signal", req),
};
