const db = require("../config/db.js") ;
const redisClient =require("../config/redis.js") ;


exports.getNomineeResults = async (req, res) => {
  try {
    const cacheKey = "nominee_results";

    // 1️⃣ Check Redis cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log("✅ Results served from Redis");
      return res.json(JSON.parse(cached));
    }

    // 2️⃣ Query MySQL if no cache
    const [rows] = await db.promise().query(`
      SELECT 
        c.id AS category_id,
        c.name AS category_name,
        n.id AS nominee_id,
        n.name AS nominee_name,
        n.county AS nominee_county,       -- 🟢 county
        n.church AS nominee_church,       -- 🟢 church
        IFNULL(SUM(v.vote_count), 0) AS total_votes,
        ROUND(
          (IFNULL(SUM(v.vote_count), 0) / NULLIF(
            (SELECT SUM(v2.vote_count) 
             FROM votes v2 
             JOIN nominees n2 ON v2.candidate_id = n2.id 
             WHERE n2.category_id = c.id), 0
          ) * 100), 2
        ) AS percentage
      FROM nominees n
      JOIN categories c ON n.category_id = c.id
      LEFT JOIN votes v ON v.candidate_id = n.id
      GROUP BY c.id, c.name, n.id, n.name, n.county, n.church
      ORDER BY c.id, total_votes DESC
    `);

    // 3️⃣ Group nominees under categories
    const results = rows.reduce((acc, row) => {
      let category = acc.find(c => c.category_id === row.category_id);
      if (!category) {
        category = {
          category_id: row.category_id,
          category_name: row.category_name,
          nominees: []
        };
        acc.push(category);
      }
      category.nominees.push({
        nominee_id: row.nominee_id,
        nominee_name: row.nominee_name,
        county: row.nominee_county,   // 🟢 include county
        church: row.nominee_church,   // 🟢 include church
        total_votes: row.total_votes,
        percentage: row.percentage
      });
      return acc;
    }, []);

    // 4️⃣ Save to Redis (expires in 60s)
    await redisClient.setEx(cacheKey, 60, JSON.stringify(results));

    console.log("✅ Results fetched from DB & cached");
    res.json(results);
  } catch (err) {
    console.error("❌ Error fetching nominee results:", err);
    res.status(500).json({ error: "Server error" });
  }
};


// Get votes grouped by category and nominee (with location & church)
exports.getVotesSummary = async (req, res) => {
  try {
    // 🔑 check cache first
    const cacheKey = "votes:summary";
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // ✅ fetch from MySQL
    const [rows] = await db.promise().query(`
       SELECT 
         c.id AS category_id,
         c.name AS category_name,
         n.id AS nominee_id,
         n.name AS nominee_name,
         n.location,
         n.church,
         IFNULL(SUM(v.vote_count), 0) AS total_votes,   -- ⭐ SUM instead of COUNT
         ROUND(
           (IFNULL(SUM(v.vote_count), 0) / NULLIF(
              (SELECT SUM(v2.vote_count) 
               FROM votes v2 
               JOIN nominees n2 ON v2.candidate_id = n2.id 
               WHERE n2.category_id = c.id), 0
            ) * 100), 2
         ) AS percentage
       FROM nominees n
       JOIN categories c ON n.category_id = c.id
       LEFT JOIN votes v ON v.candidate_id = n.id
       GROUP BY c.id, c.name, n.id, n.name, n.location, n.church
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



// 🟢 Live Results API (with category_id optional filter)
exports.getLiveResults = async (req, res) => {
  try {
    const { category_id } = req.query; // optional filter

    // cache key (unique per category if provided)
    const cacheKey = category_id ? `live_results:${category_id}` : `live_results:all`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // build query
    let sql = `
      SELECT 
        c.id AS category_id,
        c.name AS category_name,
        n.id AS nominee_id,
        n.name AS nominee_name,
        n.location,
        n.church,
        IFNULL(SUM(v.vote_count), 0) AS total_votes,
        ROUND(
          (IFNULL(SUM(v.vote_count), 0) / NULLIF(
            (SELECT SUM(v2.vote_count) 
             FROM votes v2 
             JOIN nominees n2 ON v2.candidate_id = n2.id 
             WHERE n2.category_id = c.id), 0
          ) * 100), 2
        ) AS percentage
      FROM nominees n
      JOIN categories c ON n.category_id = c.id
      LEFT JOIN votes v ON v.candidate_id = n.id
    `;

    if (category_id) {
      sql += ` WHERE c.id = ? `;
    }

    sql += `
      GROUP BY c.id, c.name, n.id, n.name, n.location, n.church
      ORDER BY c.id, total_votes DESC
    `;

    const [rows] = await db.promise().query(sql, category_id ? [category_id] : []);

    // group nominees under categories
    const results = rows.reduce((acc, row) => {
      let category = acc.find(c => c.category_id === row.category_id);
      if (!category) {
        category = {
          category_id: row.category_id,
          category_name: row.category_name,
          total_votes: 0,
          nominees: []
        };
        acc.push(category);
      }
      category.total_votes += row.total_votes;
      category.nominees.push({
        nominee_id: row.nominee_id,
        nominee_name: row.nominee_name,
        location: row.location,
        church: row.church,
        total_votes: row.total_votes,
        percentage: row.percentage
      });
      return acc;
    }, []);

    // save in redis for 10s
    await redisClient.setEx(cacheKey, 10, JSON.stringify(results));

    res.json(results);
  } catch (err) {
    console.error("❌ Error fetching live results:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};




// Get votes grouped by category and nominee (with location & church) by categoryId
exports.getVotesSummaryByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const cacheKey = `votes:summary:${categoryId}`;

    // 🔑 check cache first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // ✅ fetch from MySQL filtered by categoryId
    const [rows] = await db.promise().query(`
       SELECT 
         c.id AS category_id,
         c.name AS category_name,
         n.id AS nominee_id,
         n.name AS nominee_name,
         n.location,
         n.church,
         IFNULL(SUM(v.vote_count), 0) AS total_votes,   -- ⭐ SUM instead of COUNT
         ROUND(
           (IFNULL(SUM(v.vote_count), 0) / NULLIF(
              (SELECT SUM(v2.vote_count) 
               FROM votes v2 
               JOIN nominees n2 ON v2.candidate_id = n2.id 
               WHERE n2.category_id = c.id), 0
            ) * 100), 2
         ) AS percentage
       FROM nominees n
       JOIN categories c ON n.category_id = c.id
       LEFT JOIN votes v ON v.candidate_id = n.id
       WHERE c.id = ?
       GROUP BY c.id, c.name, n.id, n.name, n.location, n.church
       ORDER BY total_votes DESC
    `, [categoryId]);

    // cache results for 30s
    await redisClient.setEx(cacheKey, 30, JSON.stringify(rows));

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching votes:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};



// Get votes by a specific category ID
exports.getVotesByCategoryId = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const cacheKey = `votes:summary:${categoryId}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const [rows] = await db.promise().query(`
      SELECT 
        c.id AS category_id,
        c.name AS category_name,
        n.id AS nominee_id,
        n.name AS nominee_name,
        n.location,
        n.church,
        IFNULL(SUM(v.vote_count), 0) AS total_votes,
        ROUND(
          (IFNULL(SUM(v.vote_count), 0) / NULLIF(
            (SELECT SUM(v2.vote_count) 
             FROM votes v2 
             JOIN nominees n2 ON v2.candidate_id = n2.id 
             WHERE n2.category_id = c.id), 0
          ) * 100), 2
        ) AS percentage
      FROM nominees n
      JOIN categories c ON n.category_id = c.id
      LEFT JOIN votes v ON v.candidate_id = n.id
      WHERE c.id = ?
      GROUP BY c.id, c.name, n.id, n.name, n.location, n.church
      ORDER BY total_votes DESC
    `, [categoryId]);

    if (!rows.length) {
      return res.status(404).json({ message: "Category not found or no votes" });
    }

    const result = {
      category_id: rows[0].category_id,
      category_name: rows[0].category_name,
      nominees: rows.map(r => ({
        nominee_id: r.nominee_id,
        nominee_name: r.nominee_name,
        location: r.location,
        church: r.church,
        total_votes: r.total_votes,
        percentage: r.percentage
      }))
    };

    await redisClient.setEx(cacheKey, 30, JSON.stringify(result));
    res.json(result);
  } catch (err) {
    console.error("❌ Error fetching votes by category:", err.message);
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