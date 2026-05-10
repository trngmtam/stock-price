/* global React */
// SVG candlestick chart with optional prediction overlay.
// Pure SVG, no chart library. Sized via container width with ResizeObserver.

const { useState: useStateChart, useEffect: useEffectChart, useRef: useRefChart, useMemo: useMemoChart } = React;

function CandleChart({
  history,                // [{date, open, high, low, close, volume}]
  forecast,               // optional {mode, k, points: [{date, price, upper, lower}]}
  style = 'candle',       // 'candle' | 'line' | 'area'
  height = 360,
  showVolume = true,
  range = '6M',
}) {
  const wrapRef = useRefChart(null);
  const [w, setW] = useStateChart(900);
  const [hover, setHover] = useStateChart(null);

  useEffectChart(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      requestAnimationFrame(() => {
        const cw = entries[0].contentRect.width;
        setW(Math.max(320, Math.floor(cw)));
      });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Slice history by range
  const sliced = useMemoChart(() => {
    if (!history || history.length === 0) return [];
    const m = { '1M': 22, '3M': 65, '6M': 130, '1Y': 250, 'ALL': history.length };
    const n = m[range] || 130;
    return history.slice(-n);
  }, [history, range]);

  const allPoints = useMemoChart(() => {
    const f = forecast?.points || [];
    return [
      ...sliced.map(d => ({ ...d, kind: 'hist' })),
      ...f.map(p => ({ date: p.date, open: p.price, high: p.upper, low: p.lower, close: p.price, volume: 0, kind: 'fcast', upper: p.upper, lower: p.lower })),
    ];
  }, [sliced, forecast]);

  if (allPoints.length === 0) {
    return <div ref={wrapRef} className="placeholder">Awaiting historical data…</div>;
  }

  // Layout
  const padL = 8, padR = 56, padT = 8, padB = 22;
  const volH = showVolume ? 50 : 0;
  const chartH = height - padT - padB - volH - (showVolume ? 8 : 0);
  const innerW = w - padL - padR;
  const n = allPoints.length;
  const cw = innerW / n;
  const bw = Math.max(2, Math.min(10, cw * 0.65));

  // Y range over highs/lows + forecast bands
  let yMin = Infinity, yMax = -Infinity;
  allPoints.forEach(p => {
    yMin = Math.min(yMin, p.low ?? p.close);
    yMax = Math.max(yMax, p.high ?? p.close);
  });
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad; yMax += yPad;
  const yScale = v => padT + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const xScale = i => padL + i * cw + cw / 2;

  // volume scale
  let vMax = 1;
  sliced.forEach(d => { if (d.volume > vMax) vMax = d.volume; });
  const vScale = v => (v / vMax) * volH;

  // Y-axis ticks
  const ticks = 4;
  const tickArr = [];
  for (let i = 0; i <= ticks; i++) {
    const v = yMin + ((yMax - yMin) * i) / ticks;
    tickArr.push(v);
  }

  // Forecast first index
  const fcIdx = sliced.length;
  const lastHistX = fcIdx > 0 ? xScale(fcIdx - 1) : padL;

  // Line path for forecast
  const fcPts = forecast?.points || [];
  const linePath = fcPts.length
    ? 'M ' + xScale(sliced.length - 1) + ' ' + yScale(sliced[sliced.length - 1].close) +
      fcPts.map((p, i) => ' L ' + xScale(sliced.length + i) + ' ' + yScale(p.price)).join('')
    : '';

  // Confidence band path
  const bandPath = fcPts.length
    ? 'M ' + xScale(sliced.length - 1) + ' ' + yScale(sliced[sliced.length - 1].close) +
      fcPts.map((p, i) => ' L ' + xScale(sliced.length + i) + ' ' + yScale(p.upper)).join('') +
      fcPts.slice().reverse().map((p, i) => {
        const idx = fcPts.length - 1 - i;
        return ' L ' + xScale(sliced.length + idx) + ' ' + yScale(p.lower);
      }).join('') +
      ' L ' + xScale(sliced.length - 1) + ' ' + yScale(sliced[sliced.length - 1].close) + ' Z'
    : '';

  // Hover handler
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.max(0, Math.min(n - 1, Math.floor((x - padL) / cw)));
    setHover({ idx, x });
  };
  const onLeave = () => setHover(null);

  // Format date axis: show ~5 labels
  const labelEvery = Math.max(1, Math.floor(n / 5));

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${w} ${height}`}
        width={w}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        {/* y gridlines */}
        {tickArr.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={yScale(v)} y2={yScale(v)} stroke="var(--line)" strokeWidth="1" strokeDasharray={i===0||i===ticks?'':'2 4'} />
            <text x={w - padR + 6} y={yScale(v) + 3} fontFamily="var(--font-mono)" fontSize="10.5" fill="var(--ink-3)">
              {fmtPx(v, 2)}
            </text>
          </g>
        ))}

        {/* Vertical separator at forecast boundary */}
        {fcPts.length > 0 && (
          <line
            x1={lastHistX + cw / 2}
            x2={lastHistX + cw / 2}
            y1={padT}
            y2={padT + chartH}
            stroke="var(--line-2)"
            strokeDasharray="3 4"
          />
        )}

        {/* Confidence band */}
        {bandPath && (
          <path d={bandPath} fill="var(--accent-soft)" opacity="0.65" />
        )}

        {/* History candles / line / area */}
        {style === 'candle' && sliced.map((d, i) => {
          const up = d.close >= d.open;
          const x = xScale(i);
          const yO = yScale(d.open);
          const yC = yScale(d.close);
          const yH = yScale(d.high);
          const yL = yScale(d.low);
          const color = up ? 'var(--up)' : 'var(--down)';
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={yH} y2={yL} stroke={color} strokeWidth="1" />
              <rect x={x - bw/2} y={Math.min(yO, yC)} width={bw} height={Math.max(1, Math.abs(yC - yO))} fill={color} />
            </g>
          );
        })}

        {style === 'line' && (() => {
          const path = sliced.map((d, i) => (i === 0 ? 'M ' : 'L ') + xScale(i) + ' ' + yScale(d.close)).join(' ');
          return <path d={path} fill="none" stroke="var(--ink)" strokeWidth="1.5" />;
        })()}

        {style === 'area' && (() => {
          const path = sliced.map((d, i) => (i === 0 ? 'M ' : 'L ') + xScale(i) + ' ' + yScale(d.close)).join(' ');
          const fill = path + ` L ${xScale(sliced.length-1)} ${padT + chartH} L ${xScale(0)} ${padT + chartH} Z`;
          return (
            <g>
              <path d={fill} fill="var(--surface-2)" />
              <path d={path} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
            </g>
          );
        })()}

        {/* Forecast dashed line */}
        {linePath && (
          <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeDasharray="4 4" strokeLinecap="round" />
        )}
        {/* Forecast points */}
        {fcPts.map((p, i) => (
          <circle
            key={i}
            cx={xScale(sliced.length + i)}
            cy={yScale(p.price)}
            r="3"
            fill="var(--surface)"
            stroke="var(--accent)"
            strokeWidth="2"
          />
        ))}
        {/* Last forecast: target marker */}
        {fcPts.length > 0 && (() => {
          const tp = fcPts[fcPts.length - 1];
          return (
            <g>
              <line x1={xScale(sliced.length + fcPts.length - 1)} x2={w - padR} y1={yScale(tp.price)} y2={yScale(tp.price)}
                stroke="var(--accent)" strokeDasharray="2 3" strokeWidth="1" />
              <rect x={w - padR + 2} y={yScale(tp.price) - 9} width="50" height="18" rx="4" fill="var(--accent)" />
              <text x={w - padR + 27} y={yScale(tp.price) + 4} fontFamily="var(--font-mono)" fontSize="11" fill="#fff" textAnchor="middle">
                {fmtPx(tp.price, 2)}
              </text>
            </g>
          );
        })()}

        {/* X-axis labels */}
        {sliced.map((d, i) => {
          if (i % labelEvery !== 0) return null;
          return (
            <text key={i} x={xScale(i)} y={height - 6} fontFamily="var(--font-mono)" fontSize="10" fill="var(--ink-3)" textAnchor="middle">
              {d.date.slice(5)}
            </text>
          );
        })}

        {/* Volume bars */}
        {showVolume && sliced.map((d, i) => {
          const up = d.close >= d.open;
          const x = xScale(i);
          const h = vScale(d.volume);
          const yTop = padT + chartH + 8 + (volH - h);
          return (
            <rect key={i} x={x - bw/2} y={yTop} width={bw} height={h} fill={up ? 'var(--up)' : 'var(--down)'} opacity="0.35" />
          );
        })}

        {/* Hover crosshair */}
        {hover && (
          <g pointerEvents="none">
            <line x1={xScale(hover.idx)} x2={xScale(hover.idx)} y1={padT} y2={padT + chartH} stroke="var(--ink-4)" strokeDasharray="2 3" />
          </g>
        )}
      </svg>

      {/* Hover tooltip */}
      {hover && allPoints[hover.idx] && (() => {
        const p = allPoints[hover.idx];
        const isFcast = p.kind === 'fcast';
        return (
          <div style={{
            position: 'absolute',
            top: 12,
            left: Math.min(w - 200, Math.max(8, xScale(hover.idx) + 12)),
            background: 'var(--surface)',
            border: '1px solid var(--line-2)',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--ink)',
            boxShadow: 'var(--shadow-2)',
            pointerEvents: 'none',
            minWidth: 150,
          }}>
            <div style={{ color: 'var(--ink-3)', marginBottom: 4, letterSpacing: '0.04em' }}>
              {p.date} {isFcast && <span style={{ color: 'var(--accent-ink)' }}>· forecast</span>}
            </div>
            {!isFcast ? (
              <>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{color:'var(--ink-3)'}}>O</span><span>{fmtPx(p.open)}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{color:'var(--ink-3)'}}>H</span><span>{fmtPx(p.high)}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{color:'var(--ink-3)'}}>L</span><span>{fmtPx(p.low)}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{color:'var(--ink-3)'}}>C</span><span>{fmtPx(p.close)}</span></div>
              </>
            ) : (
              <>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{color:'var(--ink-3)'}}>μ</span><span>{fmtPx(p.close)}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{color:'var(--ink-3)'}}>+1σ</span><span>{fmtPx(p.upper)}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{color:'var(--ink-3)'}}>−1σ</span><span>{fmtPx(p.lower)}</span></div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

window.CandleChart = CandleChart;
