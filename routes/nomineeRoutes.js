const express = require("express");
const router = express.Router();
const {createCategory,getCategories,createNominee,getNomineesByCategory,getNomineeList} = require("../controllers/nomineeController");

// Categories
router.get("/categories", getCategories);

// Nominees
router.post("/addNominee", createNominee);
router.get("/nominees/:categoryId", getNomineesByCategory);
router.get("/list", getNomineeList);


module.exports = router;
