const pool = require("../config/db");
const redisClient = require("../config/redis");


// Get full results with Redis caching
exports.getResults = async (req, res) => {
  try {
    const cacheKey = "election_results";

    // 1️⃣ Try Redis cache first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log("✅ Results served from Redis cache");
      return res.json(JSON.parse(cached));
    }

    // 2️⃣ Query MySQL with promise pool
    const [rows] = await pool.query(`
      SELECT 
          cat.id AS category_id,
          cat.name AS category_name,
          c.id AS candidate_id,
          c.name AS candidate_name,
          COUNT(v.id) AS vote_count
      FROM candidates c
      LEFT JOIN categories cat ON c.category_id = cat.id
      LEFT JOIN votes v ON v.candidate_id = c.id
      GROUP BY cat.id, cat.name, c.id, c.name
      ORDER BY cat.id, vote_count DESC
    `);

    // 3️⃣ Group results by category
    const results = rows.reduce((acc, row) => {
      if (!acc[row.category_id]) {
        acc[row.category_id] = {
          category_id: row.category_id,
          category_name: row.category_name,
          candidates: [],
        };
      }
      acc[row.category_id].candidates.push({
        candidate_id: row.candidate_id,
        candidate_name: row.candidate_name,
        vote_count: row.vote_count,
      });
      return acc;
    }, {});

    const finalResults = Object.values(results);

    // 4️⃣ Save to Redis for 60s
    await redisClient.setEx(cacheKey, 60, JSON.stringify(finalResults));

    console.log("✅ Results fetched from DB and cached");
    res.json(finalResults);

  } catch (err) {
    console.error("❌ Error fetching results:", err);
    res.status(500).json({ error: "Server error" });
  }
};