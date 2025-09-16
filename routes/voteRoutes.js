const express = require("express");
const router = express.Router();
const { getResults } =  require("../controllers/voteControllers.js");

router.get("/results", getResults);

module.exports = router;
