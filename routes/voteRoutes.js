const express = require("express");
const router = express.Router();
const { getResults,getVotes,getVotesSummary,getNomineeResults,getVotesByCategoryId } =  require("../controllers/voteControllers.js");

router.get("/results", getResults);
router.get("/getVotes", getVotes);
router.get("/summary", getVotesSummary);
router.get("/resultsNominees", getNomineeResults);
router.get("/summary/:categoryId", getVotesByCategoryId);

module.exports = router;
