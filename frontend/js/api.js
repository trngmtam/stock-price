// API adapter: talks to the FastAPI backend (backend/app/main.py) when configured,
// falls back to deterministic mock data from mockdata.js otherwise.
//
// Configure the backend URL by setting window.QUANTA_API_URL BEFORE loading
// this script (an inline <script> in the HTML), or leave it empty/null to
// run fully offline against the mock generator.
//
// Endpoints used:
//   POST /predict/next-day        — Task 2.1 (model_21)
//   POST /predict/cumulative-7d   — Task 2.2 (model_22, fixed 7-day horizon)
//   POST /predict/multi-step-7d   — Task 2.3 (model_23, 7-day per-step)
//   POST /predict/buy-signal      — Task 3 (vietnam_buy_classifier)
//   POST /predict/sell-signal     — Task 3 (vietnam_sell_classifier)

(function () {
  const BASE_URL = (window.QUANTA_API_URL || '').replace(/\/$/, '');
  const USE_BACKEND = BASE_URL.length > 0;

  // ── Helpers ─────────────────────────────────────────────────────────────

  async function _delay(ms = 0) { return new Promise(r => setTimeout(r, ms)); }

  async function postJSON(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  function ohlcvFromHistory(hist) {
    // mockdata.js rows use lowercase keys; backend expects capitalized.
    return hist.map(r => ({
      Date:   r.date,
      Open:   r.open,
      High:   r.high,
      Low:    r.low,
      Close:  r.close,
      Volume: r.volume,
    }));
  }

  function nextWeekday(d) {
    const out = new Date(d);
    do { out.setDate(out.getDate() + 1); }
    while (out.getDay() === 0 || out.getDay() === 6);
    return out;
  }

  function isoDate(d) { return d.toISOString().slice(0, 10); }

  // crude ±1σ band from recent realized volatility (since the backend
  // doesn't return uncertainty itself).
  function sigmaFromHistory(hist, lookback = 30) {
    const tail = hist.slice(-lookback - 1);
    if (tail.length < 5) return 0.015;
    const rets = [];
    for (let i = 1; i < tail.length; i++) rets.push(Math.log(tail[i].close / tail[i-1].close));
    const m = rets.reduce((a,b)=>a+b,0) / rets.length;
    const v = rets.reduce((a,b)=>a+(b-m)*(b-m),0) / rets.length;
    return Math.sqrt(v);
  }

  // ── Read-only endpoints (still mock — no backend route for these) ───────

  async function listTickers() {
    await _delay(0);
    return window.QuantaData.TICKERS;
  }

  async function getHistory(sym, days = 240) {
    await _delay(60);
    return window.QuantaData.genHistory(sym, days);
  }

  async function getSnapshot(sym) {
    await _delay(0);
    return window.QuantaData.snapshot(sym);
  }

  // ── Prediction (real backend when configured) ───────────────────────────

  async function predict({ sym, mode = 'next', k = 1 }) {
    if (!USE_BACKEND) {
      await _delay(420);
      if (mode === 'next') return window.QuantaData.forecast(sym, 1, 'kth');
      if (mode === 'kth')  return window.QuantaData.forecast(sym, k, 'kth');
      return window.QuantaData.forecast(sym, k, 'kdays');
    }

    // Build OHLCV window from local mock history (or real history if you swap
    // in a data feed later). Need >=50 rows for indicator warm-up.
    const hist = window.QuantaData.genHistory(sym, 90);
    const last = hist[hist.length - 1];
    const lastDate = new Date(last.date);
    const sigma = sigmaFromHistory(hist, 30);
    const rows = ohlcvFromHistory(hist);
    const body = { ticker: sym, rows };

    try {
      if (mode === 'next') {
        const r = await postJSON('/predict/next-day', body);
        const nd = nextWeekday(lastDate);
        const band = r.last_close * sigma * 1.6;
        const point = {
          date: isoDate(nd), day: 1,
          price: +r.predicted_price.toFixed(2),
          upper: +(r.predicted_price + band).toFixed(2),
          lower: +(r.predicted_price - band).toFixed(2),
        };
        return { mode: 'next', k: 1, target: point, points: [point] };
      }

      // For 'kth' and 'kdays' use the multi-step 7-day model (model_23).
      // The trained models output exactly 7 days; clamp k.
      const kClamped = Math.max(1, Math.min(7, k));
      const r = await postJSON('/predict/multi-step-7d', body);
      const prices = r.predicted_prices;
      const points = [];
      let dt = new Date(lastDate);
      for (let i = 0; i < kClamped; i++) {
        dt = nextWeekday(dt);
        const px = prices[i];
        const band = r.last_close * sigma * Math.sqrt(i + 1) * 1.6;
        points.push({
          date: isoDate(dt), day: i + 1,
          price: +px.toFixed(2),
          upper: +(px + band).toFixed(2),
          lower: +(px - band).toFixed(2),
        });
      }
      if (mode === 'kth') {
        return { mode: 'kth', k: kClamped, target: points[points.length - 1], points };
      }
      return { mode: 'kdays', k: kClamped, points };
    } catch (e) {
      console.warn('[QuantaAPI] backend predict failed, falling back to mock:', e.message);
      if (mode === 'next') return window.QuantaData.forecast(sym, 1, 'kth');
      if (mode === 'kth')  return window.QuantaData.forecast(sym, k, 'kth');
      return window.QuantaData.forecast(sym, k, 'kdays');
    }
  }

  // ── Trading signals ─────────────────────────────────────────────────────

  async function getSignals(sym) {
    // Historical signal markers stay mock — generating them server-side
    // would require running the classifier on every window in history.
    await _delay(280);
    return window.QuantaData.signals(sym);
  }

  async function getTradingScore(sym) {
    if (!USE_BACKEND) {
      await _delay(60);
      return window.QuantaData.tradingScore(sym);
    }
    const hist = window.QuantaData.genHistory(sym, 90);
    const rows = ohlcvFromHistory(hist);
    const body = { ticker: sym, rows };
    try {
      const [buy, sell] = await Promise.all([
        postJSON('/predict/buy-signal', body),
        postJSON('/predict/sell-signal', body),
      ]);
      const buyP = +buy.probability.toFixed(2);
      const sellP = +sell.probability.toFixed(2);
      const hold = +Math.max(0, 1 - buyP - sellP).toFixed(2);
      return { sym, buy: buyP, sell: sellP, hold };
    } catch (e) {
      console.warn('[QuantaAPI] backend tradingScore failed, using mock:', e.message);
      return window.QuantaData.tradingScore(sym);
    }
  }

  async function getPortfolio(profile = 'balanced') {
    // Portfolio composition is a Task 4 feature; not yet exposed by backend.
    await _delay(220);
    return window.QuantaData.portfolio(profile);
  }

  window.QuantaAPI = {
    BASE_URL,
    USE_BACKEND,
    listTickers,
    getHistory,
    getSnapshot,
    predict,
    getSignals,
    getTradingScore,
    getPortfolio,
  };

  if (USE_BACKEND) {
    console.log(`[QuantaAPI] using backend at ${BASE_URL}`);
  } else {
    console.log('[QuantaAPI] no backend configured — running on mock data. Set window.QUANTA_API_URL to enable.');
  }
})();
