// Mock OHLCV generator + Vietnam ticker universe.
// Deterministic seeded RNG so the same ticker always yields the same series.
// REPLACE WITH REAL API: see js/api.js for adapter functions.

(function () {
  // --- Vietnam ticker universe (VN-Index large caps) ---
  const TICKERS = [
    { sym: 'VNM', name: 'Vinamilk',                           sector: 'Consumer',     base: 71.2,  drift:  0.04, vol: 0.012, exch: 'HOSE' },
    { sym: 'VIC', name: 'Vingroup JSC',                       sector: 'Real Estate',  base: 41.5,  drift: -0.02, vol: 0.022, exch: 'HOSE' },
    { sym: 'VHM', name: 'Vinhomes',                           sector: 'Real Estate',  base: 43.8,  drift:  0.01, vol: 0.020, exch: 'HOSE' },
    { sym: 'FPT', name: 'FPT Corporation',                    sector: 'Technology',   base: 132.4, drift:  0.09, vol: 0.014, exch: 'HOSE' },
    { sym: 'HPG', name: 'Hoa Phat Group',                     sector: 'Materials',    base: 26.7,  drift:  0.05, vol: 0.018, exch: 'HOSE' },
    { sym: 'MSN', name: 'Masan Group',                        sector: 'Consumer',     base: 78.9,  drift:  0.02, vol: 0.017, exch: 'HOSE' },
    { sym: 'VCB', name: 'Vietcombank',                        sector: 'Banking',      base: 92.6,  drift:  0.03, vol: 0.011, exch: 'HOSE' },
    { sym: 'TCB', name: 'Techcombank',                        sector: 'Banking',      base: 24.9,  drift:  0.04, vol: 0.013, exch: 'HOSE' },
    { sym: 'BID', name: 'BIDV',                               sector: 'Banking',      base: 47.8,  drift:  0.02, vol: 0.012, exch: 'HOSE' },
    { sym: 'MWG', name: 'Mobile World Investment',            sector: 'Retail',       base: 56.3,  drift:  0.06, vol: 0.019, exch: 'HOSE' },
    { sym: 'GAS', name: 'PetroVietnam Gas',                   sector: 'Energy',       base: 70.1,  drift:  0.01, vol: 0.015, exch: 'HOSE' },
    { sym: 'PLX', name: 'Petrolimex',                         sector: 'Energy',       base: 39.0,  drift:  0.00, vol: 0.014, exch: 'HOSE' },
    { sym: 'ACB', name: 'Asia Commercial Bank',               sector: 'Banking',      base: 25.8,  drift:  0.04, vol: 0.011, exch: 'HOSE' },
    { sym: 'SAB', name: 'Sabeco',                             sector: 'Consumer',     base: 52.4,  drift: -0.01, vol: 0.013, exch: 'HOSE' },
    { sym: 'HDB', name: 'HD Bank',                            sector: 'Banking',      base: 27.1,  drift:  0.03, vol: 0.013, exch: 'HOSE' },
  ];

  // Deterministic PRNG (mulberry32)
  function rng(seed) {
    let t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSym(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Generate N days of OHLCV ending today.
  function genHistory(sym, days = 240) {
    const t = TICKERS.find(x => x.sym === sym) || TICKERS[0];
    const r = rng(hashSym(sym));
    const now = new Date();
    now.setHours(0,0,0,0);
    const out = [];
    let close = t.base;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      // skip weekends
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;

      const drift = t.drift / 252;                    // annualized → daily
      const sigma = t.vol;
      const z = (r() + r() + r() + r() - 2);          // ~normal
      const ret = drift + sigma * z;
      const open  = close;
      const next  = open * Math.exp(ret);
      const high  = Math.max(open, next) * (1 + Math.abs(r()) * 0.006);
      const low   = Math.min(open, next) * (1 - Math.abs(r()) * 0.006);
      const cls   = next;
      const vol   = Math.round((0.6 + r() * 0.8) * (4_500_000 + (t.base * 25_000)));
      out.push({
        date: d.toISOString().slice(0, 10),
        open: +open.toFixed(2),
        high: +high.toFixed(2),
        low:  +low.toFixed(2),
        close: +cls.toFixed(2),
        volume: vol,
      });
      close = cls;
    }
    return out;
  }

  // Latest snapshot (price, day change %)
  function snapshot(sym) {
    const h = genHistory(sym, 30);
    const last = h[h.length - 1];
    const prev = h[h.length - 2] || last;
    const chg = ((last.close - prev.close) / prev.close) * 100;
    return { sym, close: last.close, changePct: chg, last };
  }

  // Forecast (single point or array). Pure deterministic stub. Replace via api.js.
  function forecast(sym, k = 1, mode = 'kth') {
    const hist = genHistory(sym, 60);
    const last = hist[hist.length - 1];
    const t = TICKERS.find(x => x.sym === sym) || TICKERS[0];
    const r = rng(hashSym(sym + 'fcast'));
    const drift = t.drift / 252;
    const sigma = t.vol;
    const points = [];
    let px = last.close;
    const fromDate = new Date(last.date);
    let dayOffset = 0;
    for (let i = 1; i <= k; i++) {
      // step until next weekday
      do { fromDate.setDate(fromDate.getDate() + 1); dayOffset++; }
      while (fromDate.getDay() === 0 || fromDate.getDay() === 6);
      const z = (r() + r() + r() + r() - 2);
      px = px * Math.exp(drift + sigma * z * 0.7);
      const band = px * sigma * Math.sqrt(i) * 1.6;
      points.push({
        date: fromDate.toISOString().slice(0, 10),
        day: i,
        price: +px.toFixed(2),
        upper: +(px + band).toFixed(2),
        lower: +(px - band).toFixed(2),
      });
    }
    if (mode === 'next' || mode === 'kth') {
      return { mode, k, target: points[points.length - 1], points };
    }
    return { mode, k, points };
  }

  // Buy / sell signals on history (RSI-ish; deterministic)
  function signals(sym) {
    const h = genHistory(sym, 180);
    const out = [];
    const r = rng(hashSym(sym + 'sig'));
    for (let i = 14; i < h.length; i++) {
      // crude momentum reversal detector
      const win = h.slice(i - 14, i);
      const ups = win.filter((d, idx) => idx > 0 && d.close > win[idx - 1].close).length;
      const downs = 13 - ups;
      const rsi = (ups / (ups + downs || 1)) * 100;
      const ret5 = (h[i].close / h[i - 5].close) - 1;
      // buy: RSI low + bouncing up
      if (rsi < 35 && ret5 > -0.04 && r() > 0.5) {
        out.push({ idx: i, date: h[i].date, price: h[i].close, type: 'buy',
          conf: 0.6 + r() * 0.35, reason: 'Oversold + momentum reversal (RSI<35, MACD↑)' });
      }
      // sell: RSI high + topping
      if (rsi > 70 && ret5 < 0.06 && r() > 0.5) {
        out.push({ idx: i, date: h[i].date, price: h[i].close, type: 'sell',
          conf: 0.6 + r() * 0.35, reason: 'Overbought + bearish divergence (RSI>70)' });
      }
    }
    // keep last 6 max for cleanliness
    return { history: h, signals: out.slice(-6) };
  }

  // Buy/Sell scores per ticker — for scorecard
  function tradingScore(sym) {
    const r = rng(hashSym(sym + 'score'));
    const buy  = 0.30 + r() * 0.65;
    const sell = 0.20 + r() * 0.55;
    return {
      sym,
      buy:  +buy.toFixed(2),
      sell: +sell.toFixed(2),
      hold: +Math.max(0, 1 - buy - sell + 0.3).toFixed(2),
    };
  }

  // Risk score 0–100 (lower = safer)
  function riskScore(sym) {
    const r = rng(hashSym(sym + 'risk'));
    return Math.round(20 + r() * 70);
  }

  // Profit potential — annualized projected return
  function profitPotential(sym) {
    const r = rng(hashSym(sym + 'profit'));
    return +(0.04 + r() * 0.28).toFixed(3);   // 4–32%
  }

  // Portfolio recommendation given a profile (prudent | balanced | aggressive)
  function portfolio(profile = 'balanced') {
    // Deterministic recipe per profile
    const universe = TICKERS.map(t => ({
      ...t,
      profit: profitPotential(t.sym),
      risk:   riskScore(t.sym),
    }));
    let sorted;
    if (profile === 'prudent') {
      sorted = universe.slice().sort((a,b) => a.risk - b.risk).slice(0, 6);
    } else if (profile === 'aggressive') {
      sorted = universe.slice().sort((a,b) => b.profit - a.profit).slice(0, 6);
    } else {
      sorted = universe.slice().sort((a,b) => (b.profit / Math.max(0.5, b.risk/50)) - (a.profit / Math.max(0.5, a.risk/50))).slice(0, 6);
    }
    // Allocation: weight by 1/risk * profit, normalized
    const raw = sorted.map(s => Math.max(0.01, s.profit / Math.max(0.4, s.risk / 50)));
    const sum = raw.reduce((a,b) => a+b, 0);
    const alloc = sorted.map((s, i) => ({
      sym: s.sym,
      name: s.name,
      sector: s.sector,
      profit: s.profit,
      risk: s.risk,
      weight: +(raw[i] / sum).toFixed(3),
    }));
    const portfolioRisk = Math.round(alloc.reduce((a, x) => a + x.weight * x.risk, 0));
    const expReturn = +alloc.reduce((a, x) => a + x.weight * x.profit, 0).toFixed(3);
    return { profile, holdings: alloc, risk: portfolioRisk, expReturn };
  }

  window.QuantaData = {
    TICKERS,
    genHistory,
    snapshot,
    forecast,
    signals,
    tradingScore,
    riskScore,
    profitPotential,
    portfolio,
  };
})();
