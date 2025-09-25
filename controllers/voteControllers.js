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
      JOIN votes c ON n.category_id = c.id
      LEFT JOIN votes v ON v.candidate_id = n.id
      GROUP BY c.id, c.name, n.id, n.name, n.county, n.church
      ORDER BY c.id, total_votes DESC
    `);

    // 3️⃣ Group nominees under votes
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
    const cacheKey = "votes:summary";
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
        IFNULL(SUM(v.vote_count), 0) AS votes
      FROM nominees n
      JOIN categories c ON n.category_id = c.id
      LEFT JOIN votes v ON v.candidate_id = n.id
      GROUP BY n.id, n.name, n.location, n.church, c.id, c.name
      ORDER BY c.id, votes DESC, n.name ASC
    `);

    // 🧮 Group nominees by category
    const categoryMap = new Map();
    let grandTotal = 0;

    for (const row of rows) {
      if (!categoryMap.has(row.category_id)) {
        categoryMap.set(row.category_id, {
          category_id: row.category_id,
          category_name: row.category_name,
          total_votes: 0,
          nominees: []
        });
      }
      const cat = categoryMap.get(row.category_id);

      const nominee = {
        nominee_id: row.nominee_id,
        nominee_name: row.nominee_name,
        location: row.location,
        church: row.church,
        votes: Number(row.votes)
      };

      cat.nominees.push(nominee);
      cat.total_votes += nominee.votes;
      grandTotal += nominee.votes;
    }

    // 🎯 Add percentages
    const results = [];
    for (const cat of categoryMap.values()) {
      // nominee percentages
      for (const nominee of cat.nominees) {
        nominee.percentage =
          cat.total_votes > 0 ? round2((nominee.votes / cat.total_votes) * 100) : 0;
      }

      // category percentage
      cat.category_percentage =
        grandTotal > 0 ? round2((cat.total_votes / grandTotal) * 100) : 0;

      results.push(cat);
    }

    // cache for 30s
    await redisClient.setEx(cacheKey, 30, JSON.stringify(results));

    res.json(results);
  } catch (err) {
    console.error("❌ Error fetching votes:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};
const CACHE_TTL = 10; // seconds - cache lifetime

// Helper to round to 2 decimals and return number
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

exports.getOverview = async (req, res) => {
  try {
    const categoryId = req.params.categoryId || null;
    const cacheKey = categoryId ? `votes:${categoryId}` : `votes`;

    // try cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Fetch votes per nominee (optionally filtered by category)
    const sql = `
        SELECT
          c.id AS category_id,
          c.name AS category_name,
          n.id AS nominee_id,
          n.name AS nominee_name,
          n.location,
          n.church,
          IFNULL(SUM(v.vote_count), 0) AS votes
        FROM nominees n
        JOIN categories c ON n.category_id = c.id   -- ✅ FIXED
        LEFT JOIN votes v ON v.candidate_id = n.id
        ${categoryId ? "WHERE c.id = ?" : ""}
        GROUP BY n.id, n.name, n.location, n.church, c.id, c.name
        ORDER BY c.id, votes DESC, n.name ASC
    `;

    const params = categoryId ? [categoryId] : [];
    const [rows] = await db.promise().query(sql, params);

    // Group by category and compute totals + percentages + leader flag
    const votesMap = new Map();

    for (const r of rows) {
      const catId = r.category_id;
      if (!votesMap.has(catId)) {
        votesMap.set(catId, {
          category_id: catId,
          category_name: r.category_name,
          total_votes: 0,
          nominees: []
        });
      }
      const cat = votesMap.get(catId);

      const nominee = {
        nominee_id: r.nominee_id,
        nominee_name: r.nominee_name,
        location: r.location,
        church: r.church,
        votes: Number(r.votes)
      };

      cat.nominees.push(nominee);
      cat.total_votes += Number(r.votes);
    }

    // Determine percentage and leader(s) for each category
    const results = [];
    for (const cat of votesMap.values()) {
      // find max votes to mark leader(s)
      let maxVotes = 0;
      for (const n of cat.nominees) {
        if (n.votes > maxVotes) maxVotes = n.votes;
      }

      // compute percentage and mark leader(s)
      for (const n of cat.nominees) {
        n.percentage = cat.total_votes > 0 ? round2((n.votes / cat.total_votes) * 100) : 0;
        n.is_leader = n.votes === maxVotes && maxVotes > 0;
      }

      // lastFetchedAt: when we generated this payload (frontend will display "Updated every Xs")
      cat.lastFetchedAt = new Date().toISOString();

      // optionally sort nominees by votes desc (already mostly sorted by SQL)
      cat.nominees.sort((a, b) => b.votes - a.votes || a.nominee_name.localeCompare(b.nominee_name));

      results.push(cat);
    }

    // If there are votes with no nominees in DB, they won't appear — that's expected.
    // Cache and return
    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(results));

    return res.json(results);
  } catch (err) {
    console.error("❌ Error in getOverview:", err);
    return res.status(500).json({ error: "Server error" });
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
        c.name AS category_name,   -- ✅ fixed
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
      FROM categories c
      JOIN nominees n ON n.category_id = c.id
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

    // group nominees under votes
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
       JOIN votes c ON n.category_id = c.id
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
      JOIN votes c ON n.category_id = c.id
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
      LEFT JOIN votes cat ON n.category_id = cat.id
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
    const cacheKey = "votes";

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
      FROM votes cat
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

// Get votes (with Redis cache)
exports.getAllvotes = async (req, res) => {
  try {
    const cacheData = await redisClient.get("votes");
    if (cacheData) {
      return res.json(JSON.parse(cacheData));
    }

    db.query("SELECT * FROM votes", async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      await redisClient.setEx("votes", 3600, JSON.stringify(results)); // Cache for 1hr
      res.json(results);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


exports.getDashboardTotals = async (req, res) => {
  try {
    const cacheKey = "votes:totals";
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      console.log("✅ Dashboard Totals served from Redis");
      return res.json(JSON.parse(cached));
    }

    const [[votes]] = await db.promise().query(`SELECT IFNULL(SUM(vote_count),0) AS total_votes FROM votes`);
    const [[payments]] = await db.promise().query(`SELECT IFNULL(SUM(amount_paid),0) AS total_revenue FROM payments`);
    const [[nominees]] = await db.promise().query(`SELECT COUNT(id) AS total_nominees FROM nominees`);
    const [[categories]] = await db.promise().query(`SELECT COUNT(id) AS total_categories FROM categories`);

    const data = {
      total_votes: votes.total_votes,
      total_revenue: payments.total_revenue,
      total_nominees: nominees.total_nominees,
      total_categories: categories.total_categories
    };

    await redisClient.setEx(cacheKey, 30, JSON.stringify(data));
    res.json(data);
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};


exports.getPaymentsSummary = async (req, res) => {
  try {
    const cacheKey = "votes:payments_summary";
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      console.log("✅ Payments Summary served from Redis");
      return res.json(JSON.parse(cached));
    }

    const [rows] = await db.promise().query(`
      SELECT 
        payment_method,
        COUNT(id) AS total_transactions,
        SUM(amount_paid) AS total_amount
      FROM payments
      GROUP BY payment_method
    `);

    await redisClient.setEx(cacheKey, 120, JSON.stringify(rows));
    res.json(rows);
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// Voting activity grouped per hour
exports.getVotingActivity = async (req, res) => {
  try {
    const cacheKey = "votes:activity:hourly";
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const [rows] = await db.promise().query(`
      SELECT 
        HOUR(v.vote_date) AS vote_hour,
        SUM(v.vote_count) AS total_votes
      FROM votes v
      GROUP BY HOUR(v.vote_date)
      ORDER BY vote_hour ASC
    `);

    // cache for 60s
    await redisClient.setEx(cacheKey, 60, JSON.stringify(rows));

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching voting activity:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

exports.getTopNominees = async (req, res) => {
  try {
    const cacheKey = "votes:top_nominees";
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      console.log("✅ Top Nominees served from Redis");
      return res.json(JSON.parse(cached));
    }

    const [rows] = await db.promise().query(`
      SELECT 
        c.id AS category_id,
        c.name AS category_name,
        n.id AS nominee_id,
        n.name AS nominee_name,
        IFNULL(SUM(v.vote_count), 0) AS total_votes
      FROM nominees n
      JOIN categories c ON n.category_id = c.id
      LEFT JOIN votes v ON v.candidate_id = n.id
      GROUP BY c.id, c.name, n.id, n.name
      ORDER BY c.id, total_votes DESC
    `);

    await redisClient.setEx(cacheKey, 60, JSON.stringify(rows));
    res.json(rows);
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.getVotesPerCategory = async (req, res) => {
  try {
    const cacheKey = "votes:votes_per_category";
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      console.log("✅ Votes per Category served from Redis");
      return res.json(JSON.parse(cached));
    }

    const [rows] = await db.promise().query(`
      SELECT 
        c.id AS category_id,
        c.name AS category_name,
        IFNULL(SUM(v.vote_count), 0) AS total_votes
      FROM categories c
      LEFT JOIN nominees n ON n.category_id = c.id
      LEFT JOIN votes v ON v.candidate_id = n.id
      GROUP BY c.id, c.name
      ORDER BY total_votes DESC
    `);

    await redisClient.setEx(cacheKey, 60, JSON.stringify(rows));
    res.json(rows);
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
