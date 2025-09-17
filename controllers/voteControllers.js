const db = require("../config/db.js") ;
const redisClient =require("../config/redis.js") ;



// Get votes grouped by category and nominee
exports.getVotesSummary = async (req, res) => {
  try {
    // 🔑 check cache first
    const cacheKey = "votes:summary";
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }


      //    SELECT 
      // c.id AS category_id,
      // c.name AS category_name,
      // n.id AS nominee_id,
      // n.name AS nominee_name,
      // COUNT(v.id) AS total_votes
      // FROM nominees n
      // JOIN categories c ON n.category_id = c.id
      // LEFT JOIN votes v ON v.candidate_id = n.id
      // GROUP BY c.id, n.id
      // ORDER BY c.id, total_votes DESC

    // ✅ fetch from MySQL
    const [rows] = await db.promise().query(`
       SELECT 
       c.id AS category_id,
       c.name AS category_name,
       n.id AS nominee_id,
       n.name AS nominee_name,
       COUNT(v.id) AS total_votes,
       ROUND(
       (COUNT(v.id) / NULLIF(
            (SELECT COUNT(v2.id) 
             FROM votes v2 
             JOIN nominees n2 ON v2.candidate_id = n2.id 
             WHERE n2.category_id = c.id), 0
          ) * 100), 2
        ) AS percentage
      FROM nominees n
      JOIN categories c ON n.category_id = c.id
      LEFT JOIN votes v ON v.candidate_id = n.id
      GROUP BY c.id, n.id
      ORDER BY c.id, total_votes DESC
    `);

    // cache results for 30s
    await redisClient.setEx(cacheKey, 30, JSON.stringify(rows));

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching votes:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

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

exports.getVotes = async (req, res) => {
  try {
    const cacheKey = "votes_per_category_nominee";

    // 1️⃣ Try Redis cache first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log("✅ Votes served from Redis cache");
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
      FROM categories cat
      JOIN nominees n ON n.category_id = cat.id
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

    console.log("✅ Votes fetched from DB and cached");
    res.json(finalResults);

  } catch (err) {
    console.error("❌ Error fetching votes:", err);
    res.status(500).json({ error: "Server error" });
  }
};