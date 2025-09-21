const db = require("../config/db");
const redisClient = require("../config/redis");

// Create Category
exports.createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });

    const sql = "INSERT INTO categories (name, description) VALUES (?, ?)";
    db.query(sql, [name, description], async (err, result) => {
      if (err) return res.status(500).json({ error: err.message });

      await redisClient.del("categories"); // Clear cache
      res.status(201).json({ id: result.insertId, name, description });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get Categories (with Redis cache)
exports.getCategories = async (req, res) => {
  try {
    const cacheData = await redisClient.get("categories");
    if (cacheData) {
      return res.json(JSON.parse(cacheData));
    }

    db.query("SELECT * FROM categories", async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      await redisClient.setEx("categories", 3600, JSON.stringify(results)); // Cache for 1hr
      res.json(results);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};




// Get nominees with votes & percentage
exports.getNomineeList = async (req, res) => {
  try {
    const cacheKey = "nominees";
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const [rows] = await db.promise().query(`
      SELECT 
        n.id AS nominee_id,
        n.name AS nominee_name,
        n.location,
        n.church,
        c.id AS category_id,
        c.name AS category_name,
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
      GROUP BY n.id, n.name, n.location, n.church, c.id, c.name
      ORDER BY c.id, total_votes DESC
    `);

    await redisClient.setEx(cacheKey, 60, JSON.stringify(rows));

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching nominee list with votes:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};





// Create Nominee
exports.createNominee = async (req, res) => {
  try {
    const { name, category_id, description,location,church } = req.body;
    if (!name || !category_id)
      return res.status(400).json({ message: "Name and category_id are required" });

    const sql =
      "INSERT INTO nominees (name, category_id, description,location,church) VALUES (?, ?, ?,?, ?)";
    db.query(sql, [name, category_id, description,location,church], async (err, result) => {
      if (err) return res.status(500).json({ error: err.message });

      await redisClient.del(`nominees:${category_id}`); // Clear cache for category
      res.status(201).json({ id: result.insertId, name, category_id, description });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get Nominees by Category (with Redis cache)
exports.getNomineesByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const cacheKey = `nominees:${categoryId}`;
    const cacheData = await redisClient.get(cacheKey);
    if (cacheData) {
      return res.json(JSON.parse(cacheData));
    }

    const sql = "SELECT * FROM nominees WHERE category_id = ?";
    db.query(sql, [categoryId], async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      await redisClient.setEx(cacheKey, 3600, JSON.stringify(results));
      res.json(results);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
