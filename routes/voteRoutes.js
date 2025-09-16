const express = require("express");
const router = express.Router();
const { getResults } =  require("../controllers/voteControllers.js");

router.get("/results", getResults);

export default router;
