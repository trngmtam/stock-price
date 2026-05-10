/**
 * Example React component showing how to call the backend from a Claude Design
 * prototype. Adapt the UI to whatever you've designed.
 */
import { useState } from "react";
import { stockApi, type OHLCVRow, type MultiStepResponse } from "./stockApi";

export function PredictionPanel() {
  const [ticker, setTicker] = useState("VNM");
  const [rows, setRows] = useState<OHLCVRow[]>([]); // populate from CSV upload / API
  const [forecast, setForecast] = useState<MultiStepResponse | null>(null);
  const [buyProb, setBuyProb] = useState<number | null>(null);
  const [sellProb, setSellProb] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runPrediction() {
    if (rows.length < 50) {
      setError("Need at least 50 OHLCV rows (we recommend 60+).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [multi, buy, sell] = await Promise.all([
        stockApi.predictMultiStep7d({ ticker, rows }),
        stockApi.predictBuySignal({ ticker, rows }),
        stockApi.predictSellSignal({ ticker, rows }),
      ]);
      setForecast(multi);
      setBuyProb(buy.probability);
      setSellProb(sell.probability);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <input value={ticker} onChange={(e) => setTicker(e.target.value)} />
      <button onClick={runPrediction} disabled={loading}>
        {loading ? "Predicting…" : "Predict"}
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {forecast && (
        <div>
          <p>Last close: {forecast.last_close.toFixed(2)}</p>
          <p>7-day forecast prices:</p>
          <ul>
            {forecast.predicted_prices.map((p, i) => (
              <li key={i}>
                t+{i + 1}: {p.toFixed(2)} (dir prob:{" "}
                {(forecast.direction_probabilities[i] * 100).toFixed(1)}%)
              </li>
            ))}
          </ul>
        </div>
      )}

      {buyProb !== null && (
        <p>Buy signal: {(buyProb * 100).toFixed(1)}%{buyProb >= 0.6 && " ✅ TRIGGER"}</p>
      )}
      {sellProb !== null && (
        <p>Sell signal: {(sellProb * 100).toFixed(1)}%{sellProb >= 0.6 && " ⚠️ TRIGGER"}</p>
      )}
    </div>
  );
}
