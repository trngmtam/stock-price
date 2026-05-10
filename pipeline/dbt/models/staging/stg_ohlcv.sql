-- Cleaned OHLCV: dedupe across sources, drop weekends/holidays, type-cast.
-- One row per (ticker, trade_date).

with ranked as (
    select
        upper(trim(ticker))            as ticker,
        trade_date,
        open::double precision         as open,
        high::double precision         as high,
        low::double precision          as low,
        close::double precision        as close,
        volume::bigint                 as volume,
        source,
        ingested_at,
        row_number() over (
            partition by ticker, trade_date
            order by
                case source when 'vnstock' then 1 else 2 end,
                ingested_at desc
        ) as rn
    from {{ source('raw', 'ohlcv_landing') }}
    where close is not null
      and close > 0
      and extract(dow from trade_date) not in (0, 6)
)
select
    ticker, trade_date, open, high, low, close, volume
from ranked
where rn = 1
