/* global React, ReactDOM */
// Page 1 — Predict
// Modes: next-day, kth-day, k-consecutive
// Chart-led with slim left sidebar (ticker + horizon + model).

const { useState: useStateP, useEffect: useEffectP, useMemo: useMemoP } = React;

function PredictApp() {
  const [ticker, setTicker] = useStateP('FPT');
  const [mode, setMode]     = useStateP('next');     // 'next' | 'kth' | 'kdays'
  const [k, setK]           = useStateP(7);
  const [model, setModel]   = useStateP('LSTM');
  const [range, setRange]   = useStateP('6M');
  const [chartStyle, setChartStyle] = useStateP('candle');

  const [history, setHistory] = useStateP([]);
  const [snapshot, setSnapshot] = useStateP(null);
  const [forecast, setForecast] = useStateP(null);
  const [loading, setLoading]   = useStateP(false);

  const tickerObj = useMemoP(
    () => window.QuantaData.TICKERS.find(t => t.sym === ticker) || window.QuantaData.TICKERS[0],
    [ticker]
  );

  // Read tweaks (chart style override)
  useEffectP(() => {
    const sync = () => {
      const cs = document.documentElement.getAttribute('data-chart');
      if (cs) setChartStyle(cs);
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-chart'] });
    return () => obs.disconnect();
  }, []);

  // Load history + snapshot when ticker changes
  useEffectP(() => {
    let on = true;
    window.QuantaAPI.getHistory(ticker, 250).then(h => on && setHistory(h));
    window.QuantaAPI.getSnapshot(ticker).then(s => on && setSnapshot(s));
    return () => { on = false; };
  }, [ticker]);

  // Re-run forecast on inputs change
  useEffectP(() => {
    let on = true;
    setLoading(true);
    const horizon = mode === 'next' ? 1 : k;
    window.QuantaAPI.predict({ sym: ticker, mode, k: horizon }).then(f => {
      if (!on) return;
      setForecast(f);
      setLoading(false);
    });
    return () => { on = false; };
  }, [ticker, mode, k]);

  const last = history.length ? history[history.length - 1] : null;
  const target = forecast?.points?.length ? forecast.points[forecast.points.length - 1] : null;

  const metrics = [];
  if (last) {
    metrics.push({ label: 'LAST CLOSE',  value: fmtPx(last.close) });
    metrics.push({ label: 'DAY VOLUME',  value: fmtVol(last.volume) });
  }
  if (target && last) {
    const delta = ((target.price - last.close) / last.close) * 100;
    metrics.push({ label: mode === 'next' ? 'NEXT DAY' : (mode === 'kth' ? `DAY +${k}` : `+${k}D TARGET`),
                   value: fmtPx(target.price), dir: delta >= 0 ? 'up' : 'down' });
    metrics.push({ label: 'EXPECTED Δ',  value: fmtPct(delta, 2), dir: delta >= 0 ? 'up' : 'down' });
  }

  return (
    <div className="app">
      <Topbar active="predict" />
      <div className="workspace">
        {/* === Sidebar === */}
        <aside className="sidebar">
          <TickerSelect value={ticker} onChange={setTicker} />

          <div className="divider" />

          <div className="side-section">
            <div className="side-label">Forecast Mode</div>
            <div className="seg" style={{ '--cols': 3 }}>
              <button className={mode === 'next'  ? 'on' : ''} onClick={() => setMode('next')}>Next-day</button>
              <button className={mode === 'kth'   ? 'on' : ''} onClick={() => setMode('kth')}>k-th day</button>
              <button className={mode === 'kdays' ? 'on' : ''} onClick={() => setMode('kdays')}>k-consec.</button>
            </div>

            {mode !== 'next' && (
              <div className="field" style={{ marginTop: 6 }}>
                <div className="field-label">
                  <span>{mode === 'kth' ? 'Target day' : 'Horizon'} (k)</span>
                  <span className="num">{k}</span>
                </div>
                <input className="range" type="range" min="2" max="14" value={k} onChange={e => setK(+e.target.value)} />
                <div style={{ display:'flex', justifyContent:'space-between', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--ink-3)' }}>
                  <span>2</span><span>14</span>
                </div>
              </div>
            )}
          </div>

          <div className="divider" />
        </aside>

        {/* === Main === */}
        <main className="main">
          <Hero snapshot={snapshot} ticker={tickerObj} />

          <MetricsRow items={metrics} />

          {/* Chart panel */}
          <div className="chart-wrap" style={{ marginBottom: 18 }}>
            <div className="chart-tools">
              <div className="chart-legend">
                <span className="legend-item"><span className="legend-swatch up"></span>Up day</span>
                <span className="legend-item"><span className="legend-swatch down"></span>Down day</span>
                <span className="legend-item"><span className="legend-swatch dashed"></span>{model} forecast</span>
              </div>
              <div className="range-tabs">
                {['1M','3M','6M','1Y','ALL'].map(r => (
                  <button key={r} className={range===r?'on':''} onClick={() => setRange(r)}>{r}</button>
                ))}
              </div>
            </div>
            <CandleChart history={history} forecast={forecast} style={chartStyle} range={range} height={380} />
          </div>

          {/* Mode-specific panel below chart */}
          {mode === 'next' && <NextDayPanel forecast={forecast} last={last} model={model} loading={loading} />}
          {mode === 'kth'  && <KthDayPanel forecast={forecast} last={last} k={k} model={model} loading={loading} />}
          {mode === 'kdays'&& <KDaysPanel forecast={forecast} last={last} k={k} model={model} loading={loading} />}
        </main>
      </div>
    </div>
  );
}

function Toggle({ label, defaultOn }) {
  const [on, setOn] = useStateP(!!defaultOn);
  return (
    <div onClick={() => setOn(o => !o)} style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'6px 0', cursor:'pointer', fontSize:13, color:'var(--ink-2)'
    }}>
      <span>{label}</span>
      <span style={{
        width: 30, height: 16, borderRadius: 999,
        background: on ? 'var(--ink)' : 'var(--line-2)',
        position: 'relative', transition: 'background 120ms',
      }}>
        <span style={{
          position:'absolute', top:2, left: on ? 16 : 2,
          width: 12, height: 12, borderRadius: '50%', background: '#fff',
          transition: 'left 120ms',
        }} />
      </span>
    </div>
  );
}

// --- Mode panels ---

function NextDayPanel({ forecast, last, model, loading }) {
  if (!forecast || !last) return null;
  const p = forecast.points[0];
  const delta = ((p.price - last.close) / last.close) * 100;
  const dir = delta >= 0 ? 'up' : 'down';
  return (
    <div className="grid-3">
      <div className="card" style={{gridColumn:'span 2'}}>
        <div className="card-head">
          <div>
            <div className="eyebrow">Next-day forecast</div>
            <div className="card-title" style={{marginTop:4}}>Tomorrow's projected close</div>
            <div className="card-sub">Single-step prediction · {model} · trained on multi-feature OHLCV window of 60 days</div>
          </div>
          {loading && <span className="tag">PREDICTING…</span>}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:0, borderTop:'1px solid var(--line)', borderBottom:'1px solid var(--line)' }}>
          <Stat label="Predicted close" value={fmtPx(p.price)} accent="ink" />
          <Stat label="Δ from today" value={fmtPct(delta, 2)} accent={dir} />
          <Stat label="Confidence band" value={`${fmtPx(p.lower)} — ${fmtPx(p.upper)}`} />
        </div>
      </div>
      <ModelInfoCard model={model} mae={1.42} rmse={2.31} mape={1.18} horizon={1} />
    </div>
  );
}

function KthDayPanel({ forecast, last, k, model, loading }) {
  if (!forecast || !last) return null;
  const p = forecast.points[forecast.points.length - 1];
  const delta = ((p.price - last.close) / last.close) * 100;
  const dir = delta >= 0 ? 'up' : 'down';
  return (
    <div className="grid-3">
      <div className="card" style={{gridColumn:'span 2'}}>
        <div className="card-head">
          <div>
            <div className="eyebrow">k-th day forecast</div>
            <div className="card-title" style={{marginTop:4}}>Projected close on day +{k}</div>
            <div className="card-sub">Single-target prediction · model directly outputs day +{k} (not iterated)</div>
          </div>
          {loading && <span className="tag">PREDICTING…</span>}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:0, borderTop:'1px solid var(--line)', borderBottom:'1px solid var(--line)' }}>
          <Stat label={`Day +${k} close`} value={fmtPx(p.price)} accent="ink" />
          <Stat label="Δ from today" value={fmtPct(delta, 2)} accent={dir} />
          <Stat label="Date" value={p.date} />
        </div>
      </div>
      <ModelInfoCard model={model} mae={(1.42 + k*0.21).toFixed(2)} rmse={(2.31+k*0.3).toFixed(2)} mape={(1.18+k*0.16).toFixed(2)} horizon={k} />
    </div>
  );
}

function KDaysPanel({ forecast, last, k, model, loading }) {
  if (!forecast || !last) return null;
  const pts = forecast.points;
  const maxAbs = Math.max(...pts.map(p => Math.abs(p.price - last.close)));
  return (
    <div className="grid-3">
      <div className="card" style={{gridColumn:'span 2'}}>
        <div className="card-head">
          <div>
            <div className="eyebrow">k consecutive days</div>
            <div className="card-title" style={{marginTop:4}}>Forecast — next {k} trading days</div>
            <div className="card-sub">Sequence prediction · seq2seq decoder · errors compound with horizon</div>
          </div>
          {loading && <span className="tag">PREDICTING…</span>}
        </div>
        <div className="forecast-list">
          {pts.map((p, i) => {
            const delta = ((p.price - last.close) / last.close) * 100;
            const dir = delta >= 0 ? 'up' : 'down';
            const w = (Math.abs(p.price - last.close) / Math.max(0.01, maxAbs)) * 100;
            const left = delta >= 0 ? 50 : (50 - w/2);
            return (
              <div className="forecast-row" key={i}>
                <span className="day">D+{p.day}</span>
                <span className="date">{p.date}</span>
                <span className="bar">
                  <i style={{ left: `${50 - (delta < 0 ? w : 0)}%`, width: `${w}%`, background: dir==='up'?'var(--up)':'var(--down)' }}></i>
                  <i style={{ left:'50%', width:'1px', background:'var(--ink-4)', borderRadius:0 }}></i>
                </span>
                <span className="px">{fmtPx(p.price)}</span>
                <span className={'delta ' + dir}>{fmtPct(delta, 2)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <ModelInfoCard model={model} mae={(1.42 + k*0.18).toFixed(2)} rmse={(2.31+k*0.27).toFixed(2)} mape={(1.18+k*0.13).toFixed(2)} horizon={k} />
    </div>
  );
}

function Stat({ label, value, accent }) {
  const cls = accent === 'up' || accent === 'down' ? ' ' + accent : '';
  return (
    <div style={{ padding:'14px 18px', borderRight:'1px solid var(--line)' }}>
      <div className="lbl" style={{
        fontFamily:'var(--font-mono)', fontSize:10.5, letterSpacing:'0.06em',
        color:'var(--ink-3)', textTransform:'uppercase', marginBottom:4
      }}>{label}</div>
      <div className={'val' + cls} style={{
        fontFamily:'var(--font-mono)', fontSize:17, fontWeight:500,
        color: accent === 'up' ? 'var(--up)' : (accent === 'down' ? 'var(--down)' : 'var(--ink)'),
        fontVariantNumeric:'tabular-nums'
      }}>{value}</div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', borderBottom:'1px solid var(--line)', paddingBottom:8 }}>
      <span style={{ color:'var(--ink-3)', fontSize:12 }}>{k}</span>
      <span style={{ fontFamily:'var(--font-mono)', fontVariantNumeric:'tabular-nums', fontSize:13 }}>{v}</span>
    </div>
  );
}

// Mount
ReactDOM.createRoot(document.getElementById('root')).render(<PredictApp />);
