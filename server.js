const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const redisClient = require('./config/redis');
const app = express();
require('dotenv').config();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


// Routes
// app.use('/api/vendors', require('./routes/vendors'));
// app.use('/api/products', require('./routes/products'));
// app.use('/api/customers', require('./routes/customers'));
// app.use('/api/orders', require('./routes/orders'));

app.use("/api/nominee",  require("./routes/nomineeRoutes"));
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/votes", require("./routes/voteRoutes"));
app.use("/payment", require("./payments/mpesa_stkPush"));
app.use("/transaction", require("./routes/paymentRoutes"));



app.get('/', async (req, res) => {
  res.send({ message: 'Amac server' });
});



const PORT = process.env.PORT || 9000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Amac Server running on http://localhost:${PORT}`);
});