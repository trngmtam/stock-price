-- Override dbt's default schema-naming behavior so `+schema: stg` resolves to
-- `stg` directly (not `{target.schema}_stg`). This lets our DAG query
-- `stg.stg_ohlcv` and `mart.feature_daily` without a prefix.

{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
