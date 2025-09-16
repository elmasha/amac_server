const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required on Render Postgres
  },
});

pool.on("connect", () => {
  console.log("✅ Connected PostgreSQL");
});

module.exports = pool;