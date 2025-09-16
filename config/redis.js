const { createClient } = require("redis");

console.log("REDIS_URL:", process.env.REDIS_URL); // 👈 add this for debugging

const client = createClient({
  url: process.env.REDIS_URL,   // ✅ must come from Render
});

client.on("connect", () => console.log("✅ Connected to Redis"));
client.on("error", (err) => console.error("❌ Redis error:", err));

(async () => {
  await client.connect();
})();


module.exports = createClient;