const express = require("express");
const router = express.Router();
const { getResults,getVotes } =  require("../controllers/voteControllers.js");

router.get("/results", getResults);
router.get("/getVotes", getVotes);


module.exports = router;
