/* global React, ReactDOM */
// Page 3 — Portfolio (donut + risk gauge + recommended list)

const { useState: useStateF, useEffect: useEffectF, useMemo: useMemoF } = React;

const ALLOC_COLORS = ['#1F8A5B', '#2059D6', '#B47A0E', '#7A5AE0', '#0E5234', '#5C7CCB', '#CB7E2F', '#3DBA8C'];

function PortfolioApp() {
  const [profile, setProfile] = useStateF('balanced');
  const [budget, setBudget] = useStateF(500); // million VND
  const [horizon, setHorizon] = useStateF('1Y');
  const [data, setData] = useStateF(null);

  useEffectF(() => {
    let on = true;
    window.QuantaAPI.getPortfolio(profile).then(d => on && setData(d));
    return () => { on = false; };
  }, [profile]);

  return (
    <div className="app">
      <Topbar active="portfolio" />
      <div className="workspace">
        <aside className="sidebar">
          <div className="side-section">
            <div className="side-label">Investor profile</div>
            <div className="seg" style={{ '--cols': 1, gridTemplateColumns: '1fr' }}>
              <ProfileBtn active={profile} value="prudent"   label="Prudent"     desc="Risk-averse · capital preservation" onClick={setProfile} />
              <ProfileBtn active={profile} value="balanced"  label="Balanced"    desc="Risk-adjusted return"               onClick={setProfile} />
              <ProfileBtn active={profile} value="aggressive"label="Aggressive"  desc="Risk-taking · growth"                onClick={setProfile} />
            </div>
          </div>

          <div className="divider" />

          <div className="side-section">
            <div className="field">
              <div className="field-label">
                <span>Budget</span>
                <span className="num">₫{budget}M</span>
              </div>
              <input className="range" type="range" min="50" max="5000" step="50" value={budget} onChange={e => setBudget(+e.target.value)} />
              <div style={{ display:'flex', justifyContent:'space-between', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--ink-3)' }}>
                <span>50M</span><span>5B</span>
              </div>
            </div>
          </div>

          <div className="divider" />

          <div className="side-section">
            <div className="side-label">Horizon</div>
            <div className="seg" style={{ '--cols': 4 }}>
              {['3M','6M','1Y','3Y'].map(h => (
                <button key={h} className={horizon===h?'on':''} onClick={()=>setHorizon(h)}>{h}</button>
              ))}
            </div>
          </div>

          <div className="divider" />

          <div className="side-section">
            <div className="side-label">Constraints</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6, fontSize:13, color:'var(--ink-2)' }}>
              <KVlite k="Max per name" v="25%" />
              <KVlite k="Max sector" v="40%" />
              <KVlite k="Min positions" v="6" />
              <KVlite k="Universe" v="VN-Index" />
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="hero-row">
            <div className="hero-left">
              <span className="eyebrow">Task 4 · Vietnam portfolio · Risk-managed</span>
              <div className="hero-ticker"><span className="sym">Portfolio</span><span className="name">{labelFor(profile)} · {horizon}</span></div>
            </div>
          </div>

          {data && (
            <>
              <MetricsRow items={[
                { label:'EXPECTED RETURN', value: fmtPct(data.expReturn*100, 2), dir:'up' },
                { label:'RISK SCORE', value: `${data.risk}/100` },
                { label:'POSITIONS', value: data.holdings.length },
                { label:'BUDGET', value: `₫${budget}M` },
              ]} />

              <div className="grid-3" style={{ marginBottom:18 }}>
                {/* Allocation card */}
                <div className="card" style={{gridColumn:'span 2', display:'grid', gridTemplateColumns:'260px 1fr', gap:24, alignItems:'center'}}>
                  <div>
                    <div className="eyebrow">Task 4.3 · composition</div>
                    <div className="card-title" style={{marginTop:4, marginBottom:8}}>Allocation</div>
                    <Donut holdings={data.holdings} />
                  </div>
                  <div className="alloc-list">
                    {data.holdings.map((h, i) => (
                      <div className="alloc-row" key={h.sym}>
                        <span className="swatch" style={{background: ALLOC_COLORS[i % ALLOC_COLORS.length]}}></span>
                        <span className="sym">{h.sym}</span>
                        <span className="name">{h.name} · {h.sector}</span>
                        <span className="pct">{(h.weight * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Risk gauge */}
                <div className="card">
                  <div className="card-head">
                    <div>
                      <div className="eyebrow">Task 4.2 · risk</div>
                      <div className="card-title" style={{marginTop:4}}>Portfolio risk</div>
                    </div>
                  </div>
                  <RiskGauge score={data.risk} />
                  <div style={{ marginTop:14, fontSize:12, color:'var(--ink-2)', lineHeight:1.55 }}>
                    Composite of <b style={{color:'var(--ink)'}}>volatility</b>,{' '}
                    <b style={{color:'var(--ink)'}}>beta</b>,{' '}
                    <b style={{color:'var(--ink)'}}>drawdown</b>, and{' '}
                    <b style={{color:'var(--ink)'}}>fundamental health</b>.
                  </div>
                </div>
              </div>

              {/* Recommended table */}
              <div className="card flush">
                <div style={{padding:'18px 20px 8px', display:'flex', justifyContent:'space-between', alignItems:'flex-end'}}>
                  <div>
                    <div className="eyebrow">Task 4.1 · profitable selection</div>
                    <div className="card-title" style={{marginTop:4}}>Recommended holdings</div>
                    <div className="card-sub">Sorted by allocation weight · risk-adjusted profit potential</div>
                  </div>
                  <div style={{display:'flex', gap:8}}>
                    <button className="btn">Export CSV</button>
                    <button className="btn primary">Place orders</button>
                  </div>
                </div>
                <table className="rec-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Sector</th>
                      <th className="right">Weight</th>
                      <th className="right">Allocation</th>
                      <th className="right">Exp. return</th>
                      <th className="right">Risk</th>
                      <th>Tag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.holdings.map((h, i) => {
                      const allocVnd = budget * h.weight;
                      const tag = h.risk < 35 ? { cls:'green',  label:'SAFE' } :
                                  h.risk < 65 ? { cls:'amber',  label:'MEDIUM' } :
                                                { cls:'red',    label:'RISKY' };
                      return (
                        <tr key={h.sym}>
                          <td>
                            <div className="ticker-cell">
                              <span className="swatch" style={{display:'inline-block', width:10, height:10, borderRadius:3, background:ALLOC_COLORS[i % ALLOC_COLORS.length]}}></span>
                              <span className="mono">{h.sym}</span>
                              <span style={{color:'var(--ink-3)'}}>{h.name}</span>
                            </div>
                          </td>
                          <td style={{color:'var(--ink-2)'}}>{h.sector}</td>
                          <td className="num">{(h.weight*100).toFixed(1)}%</td>
                          <td className="num">₫{(allocVnd).toFixed(1)}M</td>
                          <td className="num up">{fmtPct(h.profit*100, 1)}</td>
                          <td className="num">{h.risk}</td>
                          <td><span className={'tag ' + tag.cls}>{tag.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Excluded list */}
              <div className="card" style={{marginTop:18}}>
                <div className="card-head">
                  <div>
                    <div className="eyebrow">Task 4.2 · risk management</div>
                    <div className="card-title" style={{marginTop:4}}>Excluded from portfolio</div>
                    <div className="card-sub">Risk score above {profile === 'aggressive' ? 90 : profile === 'balanced' ? 75 : 60} or insufficient liquidity / data history.</div>
                  </div>
                </div>
                <ExcludedList holdings={data.holdings} />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function labelFor(p) {
  return p === 'prudent' ? 'Prudent · risk-averse' : p === 'aggressive' ? 'Aggressive · growth' : 'Balanced · risk-adjusted';
}

function ProfileBtn({ active, value, label, desc, onClick }) {
  const on = active === value;
  return (
    <div onClick={() => onClick(value)} style={{
      cursor:'pointer',
      padding:'10px 12px',
      borderRadius:'var(--r-md)',
      background: on ? 'var(--ink)' : 'transparent',
      color: on ? '#fff' : 'var(--ink)',
      transition: 'background 120ms',
      marginBottom: 4,
    }}>
      <div style={{ fontWeight:500, fontSize:13 }}>{label}</div>
      <div style={{ fontSize:11.5, color: on ? 'rgba(255,255,255,0.65)' : 'var(--ink-3)', marginTop:2 }}>{desc}</div>
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

function Donut({ holdings }) {
  const size = 220;
  const r = 88;
  const cx = size/2, cy = size/2;
  const total = holdings.reduce((a,h) => a + h.weight, 0) || 1;
  let acc = 0;
  return (
    <div className="donut-wrap" style={{ width:size, height:size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line)" strokeWidth="22" />
        {holdings.map((h, i) => {
          const startA = (acc / total) * Math.PI * 2 - Math.PI/2;
          acc += h.weight;
          const endA   = (acc / total) * Math.PI * 2 - Math.PI/2;
          const x1 = cx + r * Math.cos(startA), y1 = cy + r * Math.sin(startA);
          const x2 = cx + r * Math.cos(endA),   y2 = cy + r * Math.sin(endA);
          const large = (endA - startA) > Math.PI ? 1 : 0;
          const path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
          return <path key={i} d={path} fill="none" stroke={ALLOC_COLORS[i % ALLOC_COLORS.length]} strokeWidth="22" strokeLinecap="butt" />;
        })}
      </svg>
      <div className="donut-center">
        <div>
          <div className="lbl">Holdings</div>
          <div className="val">{holdings.length}</div>
        </div>
      </div>
    </div>
  );
}

function RiskGauge({ score }) {
  // Half-circle gauge
  const w = 240, h = 140;
  const cx = w/2, cy = 120, r = 88;
  const startA = Math.PI;
  const endA = 0;
  const angle = startA - (score / 100) * (startA - endA);
  // Generate arc segments by color zones
  const seg = (a0, a1, color) => {
    const x1 = cx + r * Math.cos(a0), y1 = cy + r * Math.sin(a0);
    const x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
    const large = (a0 - a1) > Math.PI ? 1 : 0;
    return <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 0 ${x2} ${y2}`} fill="none" stroke={color} strokeWidth="14" strokeLinecap="butt" />;
  };
  const a0 = Math.PI;
  const a30 = Math.PI - 0.3 * Math.PI;
  const a70 = Math.PI - 0.7 * Math.PI;
  const a100 = 0;
  const needleX = cx + (r-2) * Math.cos(angle);
  const needleY = cy + (r-2) * Math.sin(angle);
  const label = score < 35 ? 'LOW' : score < 65 ? 'MEDIUM' : 'HIGH';
  return (
    <div className="gauge-wrap">
      <svg className="gauge-svg" viewBox={`0 0 ${w} ${h}`}>
        {seg(a0, a30, 'var(--up)')}
        {seg(a30, a70, '#E1B567')}
        {seg(a70, a100, 'var(--down)')}
        {/* needle */}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="5" fill="var(--ink)" />
        <text className="gauge-num" x={cx} y={cy - 16}>{score}</text>
        <text className="gauge-lbl" x={cx} y={cy + 14}>{label}</text>
      </svg>
    </div>
  );
}

function ExcludedList({ holdings }) {
  // Pick a few "risky" tickers from the universe NOT in holdings
  const heldSet = new Set(holdings.map(h => h.sym));
  const universe = window.QuantaData.TICKERS.filter(t => !heldSet.has(t.sym));
  const excluded = universe
    .map(t => ({ ...t, risk: window.QuantaData.riskScore(t.sym), profit: window.QuantaData.profitPotential(t.sym) }))
    .sort((a,b) => b.risk - a.risk)
    .slice(0, 4);

  return (
    <div className="alloc-list">
      {excluded.map(e => (
        <div key={e.sym} className="alloc-row" style={{ gridTemplateColumns:'14px 60px 1fr 80px 60px' }}>
          <span className="swatch" style={{ background:'var(--down-soft)' }}></span>
          <span className="sym">{e.sym}</span>
          <span className="name">{e.name} · {e.sector}</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:11.5, color:'var(--down)' }}>risk {e.risk}</span>
          <span className="tag red">EXCLUDED</span>
        </div>
      ))}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PortfolioApp />);
