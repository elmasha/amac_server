const express = require("express");
const router = express.Router();
const { getResults,getVotes,getVotesSummary } =  require("../controllers/voteControllers.js");

router.get("/results", getResults);
router.get("/getVotes", getVotes);
router.get("/summary", getVotesSummary);


module.exports = router;
