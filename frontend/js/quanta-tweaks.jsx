/* global React, ReactDOM */
// Quanta tweaks panel — exposes accent / fontpair / chart style.

(function () {
  const TWEAKS_DEFAULTS = (window.__TWEAK_DEFAULTS) || { accent:'#1F8A5B', fontpair:'grotesk', chart:'candle' };

  // Map accent hex -> css attr value
  const ACCENT_MAP = {
    '#1F8A5B': 'green',
    '#2059D6': 'blue',
    '#B47A0E': 'amber',
  };

  function QuantaTweaks() {
    const [tweaks, setTweak] = window.useTweaks(TWEAKS_DEFAULTS);

    React.useEffect(() => {
      const a = ACCENT_MAP[tweaks.accent] || tweaks.accent;
      document.documentElement.setAttribute('data-accent', a);
      document.documentElement.setAttribute('data-fontpair', tweaks.fontpair);
      document.documentElement.setAttribute('data-chart', tweaks.chart);
    }, [tweaks.accent, tweaks.fontpair, tweaks.chart]);

    return (
      <window.TweaksPanel title="Tweaks">
        <window.TweakSection label="Accent">
          <window.TweakColor
            label="Accent"
            value={tweaks.accent}
            options={['#1F8A5B', '#2059D6', '#B47A0E']}
            onChange={v => setTweak('accent', v)}
          />
        </window.TweakSection>

        <window.TweakSection label="Type">
          <window.TweakSelect
            label="Font pair"
            value={tweaks.fontpair}
            options={[
              { value:'grotesk', label:'Space Grotesk + JB Mono' },
              { value:'plex',    label:'IBM Plex Sans + Mono' },
              { value:'manrope', label:'Manrope + JB Mono' },
              { value:'serif',   label:'Instrument Serif + Manrope' },
            ]}
            onChange={v => setTweak('fontpair', v)}
          />
        </window.TweakSection>

        <window.TweakSection label="Chart">
          <window.TweakRadio
            label="Style"
            value={tweaks.chart}
            options={[
              { value:'candle', label:'Candle' },
              { value:'line',   label:'Line' },
              { value:'area',   label:'Area' },
            ]}
            onChange={v => setTweak('chart', v)}
          />
        </window.TweakSection>
      </window.TweaksPanel>
    );
  }

  const div = document.createElement('div');
  div.id = '__tweaks_root';
  document.body.appendChild(div);
  ReactDOM.createRoot(div).render(<QuantaTweaks />);
})();
