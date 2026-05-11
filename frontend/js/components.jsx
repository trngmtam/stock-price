/* global React, ReactDOM */
// Shared UI: AppShell (topbar + nav), TickerSelect, MetricsRow, etc.
// Loaded after react/babel + mockdata.js + api.js.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// --- Tiny icons (Lucide-ish, inlined SVG) ---
const Icon = {
  Search: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
    </svg>
  ),
  Up: (p) => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 5l8 12H4z"/>
    </svg>
  ),
  Down: (p) => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 19L4 7h16z"/>
    </svg>
  ),
  Spark: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
    </svg>
  ),
  Sliders: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
      <circle cx="9" cy="6" r="2.2" fill="white"/><circle cx="15" cy="12" r="2.2" fill="white"/><circle cx="7" cy="18" r="2.2" fill="white"/>
    </svg>
  ),
};

function fmtPx(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPct(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  const s = n >= 0 ? '+' : '';
  return s + n.toFixed(d) + '%';
}
function fmtVol(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return String(n);
}

// --- Topbar with brand + nav + market status ---
function Topbar({ active }) {
  const tabs = [
    { id: 'predict',   label: 'Predict',    href: 'predict.html'   },
    { id: 'signals',   label: 'Signals',    href: 'signals.html'   },
    { id: 'portfolio', label: 'Portfolio',  href: 'portfolio.html' },
  ];
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark"></div>
        <span>Quanta<span className="brand-suffix">/ VNSTOCK</span></span>
      </div>
      <nav className="nav">
        {tabs.map(t => (
          <a key={t.id} href={t.href} className={t.id === active ? 'active' : ''}>{t.label}</a>
        ))}
      </nav>
    </header>
  );
}

// --- Ticker select w/ search + live snapshot ---
function TickerSelect({ value, onChange }) {
  const [q, setQ] = useState('');
  const [snaps, setSnaps] = useState({});

  useEffect(() => {
    let on = true;
    Promise.all(window.QuantaData.TICKERS.map(t => window.QuantaAPI.getSnapshot(t.sym)))
      .then(rows => {
        if (!on) return;
        const m = {};
        rows.forEach(s => m[s.sym] = s);
        setSnaps(m);
      });
    return () => { on = false; };
  }, []);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return window.QuantaData.TICKERS.filter(t => {
      if (!ql) return true;
      return t.sym.toLowerCase().includes(ql) || t.name.toLowerCase().includes(ql);
    });
  }, [q]);

  return (
    <div className="side-section">
      <div className="side-label">Ticker</div>
      <div className="ticker-search">
        <Icon.Search />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search VN tickers" />
      </div>
      <div className="ticker-list" role="listbox">
        {list.map(t => {
          const s = snaps[t.sym];
          const chg = s ? s.changePct : 0;
          const dir = chg >= 0 ? 'up' : 'down';
          return (
            <div
              key={t.sym}
              className={'ticker-row' + (t.sym === value ? ' active' : '')}
              onClick={() => onChange(t.sym)}
              role="option"
              aria-selected={t.sym === value}
            >
              <span className="ticker-sym">{t.sym}</span>
              <span className="ticker-name">{t.name}</span>
              <span className={'ticker-chg ' + dir}>
                {s ? fmtPct(chg, 1) : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Page hero (ticker name, price, change pill) ---
function Hero({ snapshot, ticker }) {
  if (!snapshot) {
    return (
      <div className="hero-row">
        <div className="hero-left">
          <span className="eyebrow">Loading…</span>
          <div className="hero-ticker"><span className="sym">{ticker.sym}</span></div>
        </div>
      </div>
    );
  }
  const dir = snapshot.changePct >= 0 ? 'up' : 'down';
  return (
    <div className="hero-row">
      <div className="hero-left">
        <span className="eyebrow">VN-INDEX · HOSE</span>
        <div className="hero-ticker">
          <span className="sym">{ticker.sym}</span>
          <span className="name">{ticker.name}</span>
        </div>
        <div className="hero-price">
          <span className="px">{fmtPx(snapshot.close)}</span>
          <span className={'chg-pill ' + dir}>
            {dir === 'up' ? <Icon.Up /> : <Icon.Down />}
            {fmtPx(Math.abs(snapshot.changePct), 2)}%
          </span>
        </div>
      </div>
    </div>
  );
}

// --- Metrics strip ---
function MetricsRow({ items }) {
  return (
    <div className="metrics-row">
      {items.map((m, i) => (
        <div className="metric" key={i}>
          <div className="lbl">{m.label}</div>
          <div className={'val' + (m.dir ? ' ' + m.dir : '')}>{m.value}</div>
        </div>
      ))}
    </div>
  );
}

// expose
Object.assign(window, {
  Icon, fmtPx, fmtPct, fmtVol,
  Topbar, TickerSelect, Hero, MetricsRow,
});
