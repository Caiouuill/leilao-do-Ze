const { Pool } = require("pg");

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://neondb_owner:npg_XlGP7K4VJqev@ep-fancy-field-acbs8ccv-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = pool;
