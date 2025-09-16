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
      res.status(201).json({
        id: result.insertId,
        name,
        description,
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get Categories (Redis cache)
exports.getCategories = async (req, res) => {
  try {
    const cacheData = await redisClient.get("categories");
    if (cacheData) {
      return res.json(JSON.parse(cacheData));
    }

    db.query("SELECT * FROM categories", async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      await redisClient.setEx("categories", 600, JSON.stringify(results)); // 1 hr cache
     console.log("No cache - fetched from DB",results);
      res.status(200).json(results);
    });
  } catch (error) {

     console.log("error:", error.message );
    res.status(500).json({ error: error.message });
  }
};


// Bulk upload multiple categories
exports.bulkUploadCategories = (req, res) => {
  const { categories } = req.body;

  if (!Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: "Categories array is required" });
  }

  const values = categories.map((c) => [c.name, c.description || null]);

  const sql = "INSERT INTO categories (name, description) VALUES ?";

  db.query(sql, [values], async (err, result) => {
    if (err) return res.status(500).json({ error: err.message });

    try {
      // Fetch fresh categories from DB
      db.query("SELECT * FROM categories", async (err, rows) => {
        if (err) {
          console.error("Error fetching categories after insert:", err);
          return res.json({
            message: `${result.affectedRows} categories added, but cache not updated`,
          });
        }

        // Update Redis cache
        await redisClient.set("categories", JSON.stringify(rows), "EX", 3600); // expires in 1 hour

        res.json({
          message: `${result.affectedRows} categories added successfully`,
          cached: true,
        });
      });
    } catch (cacheErr) {
      console.error("Redis cache update failed:", cacheErr);
      res.json({
        message: `${result.affectedRows} categories added, but cache update failed`,
      });
    }
  });
};
