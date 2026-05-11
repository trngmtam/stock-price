// API adapter: talks to the FastAPI backend (backend/app/main.py) when configured,
// falls back to deterministic mock data from mockdata.js otherwise.
//
// Configure backend URL by setting window.QUANTA_API_URL BEFORE loading
// this script (inline <script> in the HTML).
//
// Real-time data endpoints (vnstock-backed):
//   GET  /data/tickers
//   GET  /data/history/{sym}?days=N
//   GET  /data/snapshot/{sym}
// Prediction endpoints:
//   POST /predict/next-day        — Task 2.1 (model_21)
//   POST /predict/cumulative-7d   — Task 2.2 (model_22, 7-day horizon)
//   POST /predict/multi-step-7d   — Task 2.3 (model_23, 7-day per-step)
//   POST /predict/buy-signal      — Task 3 (vietnam_buy_classifier)
//   POST /predict/sell-signal     — Task 3 (vietnam_sell_classifier)

(function () {
  const BASE_URL = (window.QUANTA_API_URL || '').replace(/\/$/, '');
  const USE_BACKEND = BASE_URL.length > 0;

  // ── Helpers ─────────────────────────────────────────────────────────────

  async function _delay(ms = 0) { return new Promise(r => setTimeout(r, ms)); }

  async function getJSON(path) {
    const res = await fetch(`${BASE_URL}${path}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GET ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async function postJSON(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  // Convert backend OHLCV bars (lowercase keys) into the shape the prediction
  // endpoint expects (capitalized keys, "Date" instead of "date").
  function barsToBackendRows(bars) {
    return bars.map(b => ({
      Date:   b.date,
      Open:   b.open,
      High:   b.high,
      Low:    b.low,
      Close:  b.close,
      Volume: b.volume,
    }));
  }

  function nextWeekday(d) {
    const out = new Date(d);
    do { out.setDate(out.getDate() + 1); }
    while (out.getDay() === 0 || out.getDay() === 6);
    return out;
  }
  function isoDate(d) { return d.toISOString().slice(0, 10); }

  // Realized-volatility ±1σ band synth (backend doesn't return uncertainty).
  function sigmaFromBars(bars, lookback = 30) {
    const tail = bars.slice(-lookback - 1);
    if (tail.length < 5) return 0.015;
    const rets = [];
    for (let i = 1; i < tail.length; i++) rets.push(Math.log(tail[i].close / tail[i-1].close));
    const m = rets.reduce((a,b)=>a+b,0) / rets.length;
    const v = rets.reduce((a,b)=>a+(b-m)*(b-m),0) / rets.length;
    return Math.sqrt(v);
  }

  // ── Browser-side cache of history so we only fetch each ticker once
  //    per page load (the backend already caches 15min server-side too).
  const _historyCache = new Map(); // sym -> {bars, fetchedAt}
  async function fetchHistory(sym, days = 240) {
    const cached = _historyCache.get(sym);
    if (cached && cached.bars.length >= days && (Date.now() - cached.fetchedAt) < 60_000) {
      return cached.bars;
    }
    const r = await getJSON(`/data/history/${sym}?days=${days}`);
    _historyCache.set(sym, { bars: r.bars, fetchedAt: Date.now() });
    return r.bars;
  }

  // ── Public adapter functions ────────────────────────────────────────────

  async function listTickers() {
    if (USE_BACKEND) {
      try { return await getJSON('/data/tickers'); }
      catch (e) { console.warn('[QuantaAPI] tickers backend fail, mock:', e.message); }
    }
    await _delay(0);
    return window.QuantaData.TICKERS;
  }

  async function getHistory(sym, days = 240) {
    if (USE_BACKEND) {
      try { return await fetchHistory(sym, days); }
      catch (e) { console.warn('[QuantaAPI] history backend fail, mock:', e.message); }
    }
    await _delay(60);
    return window.QuantaData.genHistory(sym, days);
  }

  async function getSnapshot(sym) {
    if (USE_BACKEND) {
      try { return await getJSON(`/data/snapshot/${sym}`); }
      catch (e) { console.warn('[QuantaAPI] snapshot backend fail, mock:', e.message); }
    }
    await _delay(0);
    return window.QuantaData.snapshot(sym);
  }

  async function predict({ sym, mode = 'next', k = 1 }) {
    if (!USE_BACKEND) {
      await _delay(420);
      if (mode === 'next') return window.QuantaData.forecast(sym, 1, 'kth');
      if (mode === 'kth')  return window.QuantaData.forecast(sym, k, 'kth');
      return window.QuantaData.forecast(sym, k, 'kdays');
    }

    let bars;
    try {
      bars = await fetchHistory(sym, 90);
    } catch (e) {
      console.warn('[QuantaAPI] predict: history fetch failed, mock:', e.message);
      bars = window.QuantaData.genHistory(sym, 90);
    }
    if (!bars || bars.length < 50) {
      console.warn('[QuantaAPI] insufficient bars, falling back to mock');
      return window.QuantaData.forecast(sym, Math.max(1, k), mode === 'next' ? 'kth' : mode);
    }

    const last = bars[bars.length - 1];
    const lastDate = new Date(last.date);
    const sigma = sigmaFromBars(bars, 30);
    const body = { ticker: sym, rows: barsToBackendRows(bars) };

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
      console.warn('[QuantaAPI] predict backend failed, mock:', e.message);
      if (mode === 'next') return window.QuantaData.forecast(sym, 1, 'kth');
      if (mode === 'kth')  return window.QuantaData.forecast(sym, k, 'kth');
      return window.QuantaData.forecast(sym, k, 'kdays');
    }
  }

  async function getSignals(sym) {
    // Historical signal markers stay mock (would require running the classifier
    // on every window — Task-5.3 pipeline computes these in batch instead).
    let history;
    if (USE_BACKEND) {
      try { history = await fetchHistory(sym, 180); }
      catch { history = window.QuantaData.genHistory(sym, 180); }
    } else {
      history = window.QuantaData.genHistory(sym, 180);
    }
    const mock = window.QuantaData.signals(sym);
    return { history, signals: mock.signals };
  }

  async function getTradingScore(sym) {
    if (!USE_BACKEND) {
      await _delay(60);
      return window.QuantaData.tradingScore(sym);
    }
    let bars;
    try { bars = await fetchHistory(sym, 90); }
    catch (e) {
      console.warn('[QuantaAPI] score: history failed, mock:', e.message);
      return window.QuantaData.tradingScore(sym);
    }
    if (!bars || bars.length < 50) return window.QuantaData.tradingScore(sym);
    const body = { ticker: sym, rows: barsToBackendRows(bars) };
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
      console.warn('[QuantaAPI] tradingScore backend failed, mock:', e.message);
      return window.QuantaData.tradingScore(sym);
    }
  }

  async function getPortfolio(profile = 'balanced') {
    // Portfolio composition is a Task 4 feature (not exposed by backend yet).
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
    console.log('[QuantaAPI] no backend configured — using mock data. Set window.QUANTA_API_URL.');
  }
})();
