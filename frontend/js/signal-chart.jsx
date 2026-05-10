/* global React */
// SignalChart — extends candle chart with buy/sell triangles at signal points.
// Reuses the same SVG layout logic as CandleChart but lighter.

const { useState: useStateSC, useEffect: useEffectSC, useRef: useRefSC, useMemo: useMemoSC } = React;

function SignalChart({ history, signals = [], style = 'candle', height = 380, range = '6M' }) {
  const wrapRef = useRefSC(null);
  const [w, setW] = useStateSC(900);

  useEffectSC(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(es => requestAnimationFrame(() => setW(Math.max(320, Math.floor(es[0].contentRect.width)))));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const sliced = useMemoSC(() => {
    if (!history || history.length === 0) return [];
    const m = { '1M': 22, '3M': 65, '6M': 130, '1Y': 250, 'ALL': history.length };
    const n = m[range] || 130;
    return history.slice(-n);
  }, [history, range]);

  if (sliced.length === 0) {
    return <div ref={wrapRef} className="placeholder">Awaiting data…</div>;
  }

  // Index map from absolute history index -> sliced index
  const startAbsIdx = history.length - sliced.length;

  const padL = 8, padR = 56, padT = 18, padB = 22;
  const volH = 50;
  const chartH = height - padT - padB - volH - 8;
  const innerW = w - padL - padR;
  const n = sliced.length;
  const cw = innerW / n;
  const bw = Math.max(2, Math.min(10, cw * 0.65));

  let yMin = Infinity, yMax = -Infinity;
  sliced.forEach(p => { yMin = Math.min(yMin, p.low); yMax = Math.max(yMax, p.high); });
  const yPad = (yMax - yMin) * 0.10;
  yMin -= yPad; yMax += yPad;
  const yScale = v => padT + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const xScale = i => padL + i * cw + cw / 2;

  let vMax = 1;
  sliced.forEach(d => { if (d.volume > vMax) vMax = d.volume; });
  const vScale = v => (v / vMax) * volH;

  const ticks = 4;
  const tickArr = [];
  for (let i = 0; i <= ticks; i++) tickArr.push(yMin + ((yMax - yMin) * i) / ticks);
  const labelEvery = Math.max(1, Math.floor(n / 5));

  // Map signals onto sliced range
  const visible = signals.map(s => {
    const localIdx = s.idx - startAbsIdx;
    return localIdx >= 0 && localIdx < n ? { ...s, localIdx } : null;
  }).filter(Boolean);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg className="chart-svg" viewBox={`0 0 ${w} ${height}`} width={w} height={height}>
        {tickArr.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={yScale(v)} y2={yScale(v)} stroke="var(--line)" strokeDasharray={i===0||i===ticks?'':'2 4'} />
            <text x={w - padR + 6} y={yScale(v) + 3} fontFamily="var(--font-mono)" fontSize="10.5" fill="var(--ink-3)">{fmtPx(v, 2)}</text>
          </g>
        ))}

        {style === 'candle' && sliced.map((d, i) => {
          const up = d.close >= d.open;
          const x = xScale(i);
          const yO = yScale(d.open), yC = yScale(d.close), yH = yScale(d.high), yL = yScale(d.low);
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

        {/* Volume */}
        {sliced.map((d, i) => {
          const up = d.close >= d.open;
          const h = vScale(d.volume);
          return <rect key={i} x={xScale(i) - bw/2} y={padT + chartH + 8 + (volH - h)} width={bw} height={h} fill={up ? 'var(--up)' : 'var(--down)'} opacity="0.32" />;
        })}

        {/* Signal triangles */}
        {visible.map((s, i) => {
          const x = xScale(s.localIdx);
          const y = yScale(s.price);
          const isBuy = s.type === 'buy';
          const color = isBuy ? 'var(--up)' : 'var(--down)';
          const offset = isBuy ? 14 : -14;
          const tri = isBuy
            ? `M ${x} ${y + 22} L ${x - 6} ${y + 32} L ${x + 6} ${y + 32} Z`     // pointing up below candle
            : `M ${x} ${y - 22} L ${x - 6} ${y - 32} L ${x + 6} ${y - 32} Z`;    // pointing down above candle
          return (
            <g key={i}>
              <path d={tri} fill={color} />
              <circle cx={x} cy={y} r="3.2" fill="var(--surface)" stroke={color} strokeWidth="1.6" />
            </g>
          );
        })}

        {/* X labels */}
        {sliced.map((d, i) => {
          if (i % labelEvery !== 0) return null;
          return <text key={i} x={xScale(i)} y={height - 6} fontFamily="var(--font-mono)" fontSize="10" fill="var(--ink-3)" textAnchor="middle">{d.date.slice(5)}</text>;
        })}
      </svg>
    </div>
  );
}

window.SignalChart = SignalChart;
