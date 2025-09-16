const express = require("express");
const router = express.Router();
import express from "express";
import { getResults } from "../controllers/resultsController.js";

router.get("/results", getResults);

export default router;
