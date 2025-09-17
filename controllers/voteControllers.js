const db = require("../config/db.js") ;
const redisClient =require("../config/redis.js") ;

exports.getResults = async (req, res) => {
  try {
    const cacheKey = "election_results";

    // 1️⃣ Try Redis first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log("✅ Results served from Redis cache");
      return res.json(JSON.parse(cached));
    }

    // 2️⃣ Query MySQL
    const [rows] = await db.query(`
      SELECT 
          cat.id AS category_id,
          cat.name AS category_name,
          n.id AS nominee_id,
          n.name AS nominee_name,
          COUNT(v.id) AS vote_count
      FROM nominees n
      LEFT JOIN categories cat ON n.category_id = cat.id
      LEFT JOIN votes v ON v.nominee_id = n.id
      GROUP BY cat.id, cat.name, n.id, n.name
      ORDER BY cat.id, vote_count DESC
    `);

    // 3️⃣ Group results by category
    const results = rows.reduce((acc, row) => {
      if (!acc[row.category_id]) {
        acc[row.category_id] = {
          category_id: row.category_id,
          category_name: row.category_name,
          nominees: []
        };
      }
      acc[row.category_id].nominees.push({
        nominee_id: row.nominee_id,
        nominee_name: row.nominee_name,
        vote_count: row.vote_count
      });
      return acc;
    }, {});

    const finalResults = Object.values(results);

    // 4️⃣ Cache in Redis for 60s
    await redisClient.setEx(cacheKey, 60, JSON.stringify(finalResults));

    console.log("✅ Results fetched from DB and cached");
    res.json(finalResults);

  } catch (err) {
    console.error("❌ Error fetching results:", err);
    res.status(500).json({ error: "Server error" });
  }
};
