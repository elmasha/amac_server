const express = require("express");
const router = express.Router();
const { getResults,getVotes,getVotesSummary,getNomineeResults,getVotesByCategoryId,getVotesSummaryByCategory,getLiveResults } =  require("../controllers/voteControllers.js");

router.get("/results", getResults);
router.get("/getVotes", getVotes);
router.get("/summary", getVotesSummary);
router.get("/resultsNominees", getNomineeResults);
router.get("/summaryCat/:categoryId", getVotesByCategoryId);
router.get("/summary/:categoryId", getVotesSummaryByCategory);
router.get("/live-results", getLiveResults);



module.exports = router;
