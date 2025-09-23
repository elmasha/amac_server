const express = require("express");
const router = express.Router();
const {createPayment,getAllPayments,getPaymentById,updatePayment,deletePayment} = require("../controllers/paymentController");

// CRUD Routes
router.post("/createPayment", createPayment);
router.get("/getAllPayments", getAllPayments);
router.get("/get-by-id/:id", getPaymentById);
router.put("/Upadate/:id", updatePayment);
router.delete("/delete/:id", deletePayment);

module.exports = router;
