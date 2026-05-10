// API adapter. Replace these stubs with real fetch() calls to your model service
// (TF Serving, FastAPI, etc.). The shape of return values is documented inline.
//
// To swap to a real backend, just change BASE_URL and uncomment the fetch path
// inside each function. The UI calls these adapters only — never window.QuantaData.

(function () {
  const BASE_URL = ''; // e.g. 'http://localhost:8000/api'

  async function _delay(ms = 250) {
    return new Promise(r => setTimeout(r, ms));
  }

  // GET /tickers  -> [{sym, name, sector, exch}]
  async function listTickers() {
    await _delay(0);
    return window.QuantaData.TICKERS;
  }

  // GET /tickers/:sym/history?days=240
  // -> [{date, open, high, low, close, volume}]
  async function getHistory(sym, days = 240) {
    await _delay(60);
    return window.QuantaData.genHistory(sym, days);
  }

  // GET /tickers/:sym/snapshot -> {sym, close, changePct}
  async function getSnapshot(sym) {
    await _delay(0);
    return window.QuantaData.snapshot(sym);
  }

  // POST /predict  body: {sym, mode: 'next'|'kth'|'kdays', k}
  // -> {mode, k, target?, points: [{date, day, price, upper, lower}]}
  //
  // Replace with:
  //   const res = await fetch(`${BASE_URL}/predict`, {
  //     method: 'POST',
  //     headers: {'Content-Type': 'application/json'},
  //     body: JSON.stringify({sym, mode, k}),
  //   });
  //   return res.json();
  async function predict({ sym, mode = 'next', k = 1 }) {
    await _delay(420);
    if (mode === 'next') return window.QuantaData.forecast(sym, 1, 'kth');
    if (mode === 'kth')  return window.QuantaData.forecast(sym, k, 'kth');
    return window.QuantaData.forecast(sym, k, 'kdays');
  }

  // GET /tickers/:sym/signals -> {history, signals: [{idx, date, price, type, conf, reason}]}
  async function getSignals(sym) {
    await _delay(280);
    return window.QuantaData.signals(sym);
  }

  // GET /tickers/:sym/score -> {sym, buy, sell, hold}
  async function getTradingScore(sym) {
    await _delay(60);
    return window.QuantaData.tradingScore(sym);
  }

  // GET /portfolio?profile=prudent|balanced|aggressive
  async function getPortfolio(profile = 'balanced') {
    await _delay(220);
    return window.QuantaData.portfolio(profile);
  }

  window.QuantaAPI = {
    BASE_URL,
    listTickers,
    getHistory,
    getSnapshot,
    predict,
    getSignals,
    getTradingScore,
    getPortfolio,
  };
})();
