const express = require("express");
const router = express.Router();
const {createCategory,getCategories,createNominee,getNomineesByCategory} = require("../controllers/nomineeController");

// Categories
router.post("/categories", createCategory);
router.get("/categories", getCategories);

// Nominees
router.post("/addNominee", createNominee);
router.get("/nominees/:categoryId", getNomineesByCategory);

module.exports = router;
