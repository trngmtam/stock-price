/* global React, ReactDOM */
// Page 2 — Trading signals (buy/sell triangles on candle chart).

const { useState: useStateS, useEffect: useEffectS, useMemo: useMemoS } = React;

function SignalsApp() {
  const [ticker, setTicker] = useStateS('HPG');
  const [filter, setFilter] = useStateS('all'); // 'all' | 'buy' | 'sell'
  const [history, setHistory] = useStateS([]);
  const [signals, setSignals] = useStateS([]);
  const [snapshot, setSnapshot] = useStateS(null);
  const [score, setScore] = useStateS(null);
  const [chartStyle, setChartStyle] = useStateS('candle');
  const [range, setRange] = useStateS('6M');

  const tickerObj = useMemoS(
    () => window.QuantaData.TICKERS.find(t => t.sym === ticker) || window.QuantaData.TICKERS[0],
    [ticker]
  );

  useEffectS(() => {
    const sync = () => {
      const cs = document.documentElement.getAttribute('data-chart');
      if (cs) setChartStyle(cs);
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes:true, attributeFilter:['data-chart']});
    return () => obs.disconnect();
  }, []);

  useEffectS(() => {
    let on = true;
    window.QuantaAPI.getSignals(ticker).then(d => {
      if (!on) return;
      setHistory(d.history);
      setSignals(d.signals);
    });
    window.QuantaAPI.getSnapshot(ticker).then(s => on && setSnapshot(s));
    window.QuantaAPI.getTradingScore(ticker).then(s => on && setScore(s));
    return () => { on = false; };
  }, [ticker]);

  const filtered = useMemoS(() => {
    if (filter === 'all') return signals;
    return signals.filter(s => s.type === filter);
  }, [signals, filter]);

  const last = history.length ? history[history.length - 1] : null;

  return (
    <div className="app">
      <Topbar active="signals" />
      <div className="workspace">
        <aside className="sidebar">
          <TickerSelect value={ticker} onChange={setTicker} />

          <div className="divider" />

          <div className="side-section">
            <div className="side-label">Show</div>
            <div className="seg" style={{ '--cols': 3 }}>
              <button className={filter==='all'?'on':''} onClick={()=>setFilter('all')}>All</button>
              <button className={filter==='buy'?'on':''} onClick={()=>setFilter('buy')}>Buy</button>
              <button className={filter==='sell'?'on':''} onClick={()=>setFilter('sell')}>Sell</button>
            </div>
          </div>

          <div className="divider" />

        </aside>

        <main className="main">
          <Hero snapshot={snapshot} ticker={tickerObj} />

          {/* Signal score strip */}
          <div className="card" style={{ marginBottom:18, padding:'18px 20px' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:24, alignItems:'center' }}>
              <ScoreBlock label="BUY signal" value={score ? score.buy : 0} dir="up" />
              <ScoreBlock label="SELL signal" value={score ? score.sell : 0} dir="down" />
              <div>
                <div className="eyebrow" style={{marginBottom:8}}>Recommendation today</div>
                <Recommendation score={score} />
              </div>
            </div>
          </div>

          {/* Chart with triangles */}
          <div className="chart-wrap" style={{ marginBottom:18 }}>
            <div className="chart-tools">
              <div className="chart-legend">
                <span className="legend-item">
                  <span style={{display:'inline-block', width:0, height:0, borderLeft:'6px solid transparent', borderRight:'6px solid transparent', borderBottom:'10px solid var(--up)'}}></span>
                  Buy signal
                </span>
                <span className="legend-item">
                  <span style={{display:'inline-block', width:0, height:0, borderLeft:'6px solid transparent', borderRight:'6px solid transparent', borderTop:'10px solid var(--down)'}}></span>
                  Sell signal
                </span>
              </div>
              <div className="range-tabs">
                {['3M','6M','1Y','ALL'].map(r => (
                  <button key={r} className={range===r?'on':''} onClick={()=>setRange(r)}>{r}</button>
                ))}
              </div>
            </div>
            <SignalChart history={history} signals={filtered} style={chartStyle} range={range} height={400} />
          </div>

          {/* Recent signals list */}
          <div className="grid-3">
            <div className="card flush" style={{gridColumn:'span 2'}}>
              <div style={{ padding:'18px 20px 8px' }}>
                <div className="eyebrow">Trading signals</div>
                <div className="card-title" style={{marginTop:4}}>Recent signals on {ticker}</div>
                <div className="card-sub">Sorted newest first</div>
              </div>
              <div>
                {filtered.length === 0 && <div className="placeholder" style={{ margin:'8px 20px 20px' }}>No signals match this filter.</div>}
                {filtered.slice().reverse().map((s, i) => (
                  <div className="signal-card" key={i}>
                    <div className={'signal-tri' + (s.type === 'sell' ? ' sell' : '')}>
                      {s.type === 'buy'
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l9 16H3z"/></svg>
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20L3 4h18z"/></svg>}
                    </div>
                    <div className="signal-mid">
                      <div className="ticker">{s.type.toUpperCase()} · {s.date}</div>
                      <div className="reason">{s.reason}</div>
                    </div>
                    <div className="signal-right">
                      <div className="price">{fmtPx(s.price)}</div>
                      <div className="conf">conf {(s.conf*100).toFixed(0)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
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
function KVlite({ k, v }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12.5 }}>
      <span style={{ color:'var(--ink-3)' }}>{k}</span>
      <span style={{ fontFamily:'var(--font-mono)', fontVariantNumeric:'tabular-nums' }}>{v}</span>
    </div>
  );
}

function ScoreBlock({ label, value, dir }) {
  const pct = Math.round(value * 100);
  const color = dir === 'up' ? 'var(--up)' : 'var(--down)';
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom:8 }}>{label}</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:12, marginBottom:8 }}>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:32, fontWeight:500, color, fontVariantNumeric:'tabular-nums' }}>
          {pct}<span style={{ fontSize:18, color:'var(--ink-3)' }}>%</span>
        </span>
        <span style={{ fontSize:12, color:'var(--ink-3)' }}>probability</span>
      </div>
      <div style={{ height:6, background:'var(--line)', borderRadius:3, overflow:'hidden' }}>
        <div style={{ width:`${pct}%`, height:'100%', background:color }}></div>
      </div>
    </div>
  );
}

function Recommendation({ score }) {
  if (!score) return <div style={{ color:'var(--ink-3)' }}>—</div>;
  const max = Math.max(score.buy, score.sell, score.hold);
  let label = 'HOLD', cls = 'tag';
  if (max === score.buy)       { label = 'BUY';  cls = 'tag green'; }
  else if (max === score.sell) { label = 'SELL'; cls = 'tag red';   }
  return (
    <div>
      <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:8 }}>
        <span className={cls} style={{ fontSize:14, padding:'4px 12px' }}>{label}</span>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:13, color:'var(--ink-3)' }}>conf {Math.round(max*100)}%</span>
      </div>
      <div style={{ fontSize:12, color:'var(--ink-2)', lineHeight:1.5 }}>
        Suggested entry within next 1–3 sessions. Reassess on next close.
      </div>
    </div>
  );
}

// Mount
ReactDOM.createRoot(document.getElementById('root')).render(<SignalsApp />);
