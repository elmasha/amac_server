const express = require("express");
const request = require("request");
const bodyParser = require("body-parser");
const moment = require("moment");
const router = express.Router();
const cors = require("cors");
const db = require("../config/db");

///-----Port-----///
const _urlencoded = express.urlencoded({ extended: false });
router.use(cors());
router.use(express.json());
router.use(express.static("public"));

// ---- ALLOW ACCESS ----- //
router.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }
  next();
});

// ---- TEST ROUTE ---- //
router.get("/", (req, res) => {
  res.status(200).send({ message: "payments" });
});

// --------------------------------- //
// 🔑 ACCESS TOKEN MIDDLEWARE
// --------------------------------- //
const consumer_key = "O4FAkx1C61CyCWkGZqcMP9snAX3OrN9HE8UkewAHtPcelH1E"; 
const consumer_secret = "hAAhFusWGgAi3Ft3u7OA8OjmUoOicIUGblqF6oM27jcLGnXVGKiwC3Y0NAYJnPSn"; 
const auth = Buffer.from(consumer_key + ":" + consumer_secret).toString("base64");

function access(req, res, next) {
  request(
    {
      url: "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      headers: { Authorization: "Basic " + auth },
    },
    (error, response, body) => {
      if (error) {
        console.error("❌ Error getting token:", error);
        return res.status(500).json({ error: "Failed to get access token" });
      }
      req.access_token = JSON.parse(body).access_token;
      next();
    }
  );
}

// Temporary store (use Redis in production)
const paymentMetaStore = {};

// --------------------------------- //
// 📲 STK PUSH
// --------------------------------- //
let phoneNumber, amount, user_id, candidate_id, category_id, transaction_type, vote_count;

router.post("/mpesa_stk_push", access, express.urlencoded({ extended: false }), function (req, res) {
  phoneNumber = req.body.phone;
  amount = req.body.amount;
  user_id = req.body.user_id;
  candidate_id = req.body.candidate_id;
  category_id = req.body.category_id;
  transaction_type = req.body.transaction_type; // "vote" or "payment"
  vote_count = req.body.vote_count || 1; // ⭐ CHANGE: how many votes user wants to cast

  let endpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
  let auth = "Bearer " + req.access_token;

  let shortCode = `174379`; // Sandbox Paybill
  let passKey = `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919`;

  const timeStamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, -3);
  const password = Buffer.from(`${shortCode}${passKey}${timeStamp}`).toString("base64");

  request(
    {
      url: endpoint,
      method: "POST",
      headers: { Authorization: auth },
      json: {
        BusinessShortCode: shortCode,
        Password: password,
        Timestamp: timeStamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phoneNumber,
        PartyB: shortCode,
        PhoneNumber: phoneNumber,
        CallBackURL: "https://balanced-ambition-production.up.railway.app/payment/callback",
        AccountReference: "AMAC Voting booth",
        TransactionDesc: transaction_type === "vote" ? "Voting" : "Payment",
      },
    },
    (error, response, body) => {
      if (error) {
        console.log(error);
        return res.status(404).json(error);
      }

      // ✅ Store meta data for callback
      if (body.CheckoutRequestID) {
        paymentMetaStore[body.CheckoutRequestID] = {
          transaction_type,
          user_id,
          candidate_id,
          category_id,
          vote_count, // ⭐ CHANGE
        };
      }

      console.log("📲 STK push response:", body);
     return res.status(200).json(body);
    }
  );
});

// --------------------------------- //
// 📥 STK CALLBACK
// --------------------------------- //
router.post("/callback", async function (req, res) {
  console.log(".......... 📩 STK Callback ..................");
  console.log("RAW CALLBACK BODY:", JSON.stringify(req.body, null, 2));

  res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body.Body?.stkCallback;
    if (!callback) return console.error("❌ No stkCallback found in body");

    if (callback.ResultCode !== 0) {
      return console.warn("⚠️ Transaction failed:", callback.ResultDesc);
    }

    const metadata = callback.CallbackMetadata;
    if (!metadata) return console.error("❌ No CallbackMetadata found");

    const amount = metadata.Item.find((i) => i.Name === "Amount")?.Value;
    const transID = metadata.Item.find((i) => i.Name === "MpesaReceiptNumber")?.Value;
    const phone = metadata.Item.find((i) => i.Name === "PhoneNumber")?.Value;
    const transdate = new Date();

    const metaKey = callback.CheckoutRequestID;
    const paymentMeta = paymentMetaStore[metaKey] || {};

    const { transaction_type, user_id, candidate_id, category_id, vote_count } = paymentMeta;

    // --- Save Payment ---
    const sql = `
      INSERT INTO payments (
        category_id, payment_date, amount_paid,
        payment_method, transaction_id, payment_status, phone_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      category_id || null,
      transdate,
      amount,
      "Mpesa",
      transID,
      "Completed",
      phone || null,
    ];

    db.query(sql, values, (err, result) => {
      if (err) return console.error("❌ Error saving payment:", err.message);

      console.log("✅ Payment saved:", result);

  
        const voteSql = `
          INSERT INTO votes (user_id, candidate_id, transaction_id, vote_date, vote_count) 
          VALUES (?, ?, ?, ?, ?) 
        `;

        const voteValues = [user_id, candidate_id, transID, transdate, vote_count];

        db.query(voteSql, voteValues, (voteErr, voteResult) => {
          if (voteErr) return console.error("❌ Error saving vote:", voteErr.message);
          console.log("🗳️ Vote recorded:", voteResult);
        });
      

      delete paymentMetaStore[metaKey]; // ✅ Clean memory
    });
  } catch (err) {
    console.error("❌ Callback handling error:", err.message);
  }
});


router.post(
    "/mpesa_stk_push/query",access,function(req, res, next) {
        let _checkoutRequestId = req.body.checkoutRequestId;

       let auth = "Bearer " + req.access_token;

        let endpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query";
        let _shortCode = "174379";
        let _passKey =
            "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
        const timeStamp = new Date()
            .toISOString()
            .replace(/[^0-9]/g, "")
            .slice(0, -3);
        const password = Buffer.from(
            `${_shortCode}${_passKey}${timeStamp}`
        ).toString("base64");

        request({
                url: endpoint,
                method: "POST",
                headers: {
                    Authorization:  auth,
                },
                json: {
                    BusinessShortCode: _shortCode,
                    Password: password,
                    Timestamp: timeStamp,
                    CheckoutRequestID: _checkoutRequestId,
                },
            },
            function(error, response, body) {
                if (error) {
                    console.log(error);
                    res.status(404).json(body);
                } else {
                    var resDesc = body.ResponseDescription;
 res.status(200).json(body);
                    if (res.status(200)) {
                       
                        var resDesc = body.ResponseDescription;
                        var resultDesc = body.ResultDesc;
                        console.log("Query Body", body);
                    }

                    next();
                }
            }
        );
    }
);



module.exports = router;