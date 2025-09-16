const express = require("express");
const router = express.Router();
const {createCategory,getCategories,bulkUploadCategories} = require("../controllers/categoryController");

// Create new category
router.post("/", createCategory);

// Get all categories (cached)
router.get("/getAll", getCategories);

router.post("/bulk", bulkUploadCategories);


module.exports = router;
