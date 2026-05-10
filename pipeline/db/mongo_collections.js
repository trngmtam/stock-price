// MongoDB collections for the unstructured side of the pipeline.
// Run via:   mongosh stocks_unstructured pipeline/db/mongo_collections.js

// Why MongoDB here:
// News / filings / analyst reports are heterogeneous (variable fields, nested
// entities, free text). Postgres handles the strict OHLCV+features+predictions
// side; Mongo handles the flexible-schema side and the two are joined on
// (ticker, trade_date) at the analytics layer.

// ── news_articles ─────────────────────────────────────────────────────
db.createCollection("news_articles", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["url", "ticker", "published_at", "ingested_at"],
      properties: {
        url:           { bsonType: "string" },
        ticker:        { bsonType: "string" },
        title:         { bsonType: "string" },
        body:          { bsonType: "string" },
        source:        { bsonType: "string" },        // e.g. cafef, vneconomy
        published_at:  { bsonType: "date" },
        ingested_at:   { bsonType: "date" },
        sentiment:     { bsonType: ["double", "null"] }, // filled by NLP step
        entities:      { bsonType: ["array", "null"] },
      },
    },
  },
});
db.news_articles.createIndex({ ticker: 1, published_at: -1 });
db.news_articles.createIndex({ url: 1 }, { unique: true });

// ── prediction_audit ──────────────────────────────────────────────────
// Full request/response payload for every model call (debugging, drift study).
db.createCollection("prediction_audit");
db.prediction_audit.createIndex({ ticker: 1, run_date: -1 });
db.prediction_audit.createIndex({ created_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
