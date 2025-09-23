const express = require("express");
const router = express.Router();
const { getResults,getVotes,getVotesSummary,getNomineeResults,getVotesByCategoryId,getVotesSummaryByCategory,getLiveResults,getOverview,getAllvotes,
    getDashboardTotals,getPaymentsSummary,getVotingActivity,getTopNominees,getVotesPerCategory } =  require("../controllers/voteControllers.js");

router.get("/results", getResults);
router.get("/getVotes", getVotes);
router.get("/get-all-votes", getAllvotes);
router.get("/summary", getVotesSummary);
router.get("/resultsNominees", getNomineeResults);
router.get("/summaryCat/:categoryId", getVotesByCategoryId);
router.get("/summary/:categoryId", getVotesSummaryByCategory);
router.get("/live-results", getLiveResults);
router.get("/overview", getOverview);
router.get("/overview/:categoryId", getOverview);
router.get("/dashboard-total", getDashboardTotals);
router.get("/payment-summaery", getPaymentsSummary);
router.get("/voting-activity", getVotingActivity);
router.get("/top-nominees", getTopNominees);
router.get("/vote-category", getVotesPerCategory);


module.exports = router;
