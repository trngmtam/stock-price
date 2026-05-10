-- Mart: technical features per (ticker, trade_date) — exactly the feature set
-- used by Task 2 models. Incremental: re-runs only on rows newer than the
-- max(trade_date) already materialized.

{{ config(
    materialized = 'incremental',
    unique_key   = ['ticker', 'trade_date']
) }}

with base as (
    select * from {{ ref('stg_ohlcv') }}
    {% if is_incremental() %}
        -- include 60d of history for indicator warm-up
        where trade_date >= (select max(trade_date) - interval '60 day' from {{ this }})
    {% endif %}
),
w as (
    select
        ticker,
        trade_date,
        open, high, low, close, volume,
        ln(close / nullif(lag(close) over w, 0))                              as log_ret,
        (high - low) / nullif(close, 0)                                       as hl_range,
        (close - open) / nullif(open, 0)                                      as oc_range,
        close / nullif(avg(close)  over (partition by ticker order by trade_date rows 4 preceding), 0)  - 1 as sma5_ratio,
        close / nullif(avg(close)  over (partition by ticker order by trade_date rows 19 preceding), 0) - 1 as sma20_ratio,
        ln(1 + volume)                                                        as log_volume,
        close / nullif(lag(close, 5)  over w, 0) - 1                          as mom_5,
        close / nullif(lag(close, 20) over w, 0) - 1                          as mom_20,
        stddev_pop(ln(close / nullif(lag(close) over w, 0)))
            over (partition by ticker order by trade_date rows 19 preceding) as vol_20
    from base
    window w as (partition by ticker order by trade_date)
)
select
    ticker, trade_date,
    log_ret, hl_range, oc_range,
    sma5_ratio, sma20_ratio,
    null::double precision as macd_norm,     -- computed in Python step (EWMA easier there)
    null::double precision as macd_signal,
    null::double precision as rsi14,
    null::double precision as bb_pos,
    vol_20, log_volume, mom_5, mom_20
from w
where log_ret is not null
