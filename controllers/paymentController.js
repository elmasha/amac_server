const db = require("../config/db");
const redisClient = require("../config/redis");

// ✅ Create Payment
exports.createPayment = async (req, res) => {
  try {
    const { payment_date, amount_paid, payment_method, transaction_id, payment_status, phone_number, category_id } = req.body;

    const [result] = await db.promise().query(
      `INSERT INTO payments (payment_date, amount_paid, payment_method, transaction_id, payment_status, phone_number, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [payment_date, amount_paid, payment_method, transaction_id, payment_status, phone_number, category_id || null]
    );

    // Clear cache
    await redisClient.del("payments:all");

    res.status(201).json({ message: "✅ Payment created", id: result.insertId });
  } catch (err) {
    console.error("❌ Error creating payment:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Read All Payments
exports.getAllPayments = async (req, res) => {
  try {
    const cacheKey = "payments:all";
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      console.log("✅ Payments served from Redis");
      return res.json(JSON.parse(cached));
    }

    const [rows] = await db.promise().query(`SELECT * FROM payments ORDER BY payment_date DESC`);

    await redisClient.setEx(cacheKey, 120, JSON.stringify(rows)); // cache 2 mins
    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching payments:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Read Single Payment
exports.getPaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `payments:${id}`;

    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log("✅ Single Payment served from Redis");
      return res.json(JSON.parse(cached));
    }

    const [rows] = await db.promise().query(`SELECT * FROM payments WHERE id = ?`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Payment not found" });

    await redisClient.setEx(cacheKey, 120, JSON.stringify(rows[0]));
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error fetching payment:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Update Payment
exports.updatePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_date, amount_paid, payment_method, transaction_id, payment_status, phone_number, category_id } = req.body;

    const [result] = await db.promise().query(
      `UPDATE payments 
       SET payment_date=?, amount_paid=?, payment_method=?, transaction_id=?, payment_status=?, phone_number=?, category_id=? 
       WHERE id=?`,
      [payment_date, amount_paid, payment_method, transaction_id, payment_status, phone_number, category_id || null, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ error: "Payment not found" });

    // Invalidate cache
    await redisClient.del("payments:all");
    await redisClient.del(`payments:${id}`);

    res.json({ message: "✅ Payment updated" });
  } catch (err) {
    console.error("❌ Error updating payment:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ✅ Delete Payment
exports.deletePayment = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.promise().query(`DELETE FROM payments WHERE id=?`, [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Payment not found" });

    // Invalidate cache
    await redisClient.del("payments:all");
    await redisClient.del(`payments:${id}`);

    res.json({ message: "✅ Payment deleted" });
  } catch (err) {
    console.error("❌ Error deleting payment:", err);
    res.status(500).json({ error: "Server error" });
  }
};
