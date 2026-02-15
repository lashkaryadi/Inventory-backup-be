import express from "express";
import { getProfitAnalytics, exportProfitExcel } from "../controllers/analyticsController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Main analytics endpoint
router.get("/", protect, getProfitAnalytics);

// Export analytics to Excel
router.get("/export/excel", protect, exportProfitExcel);

export default router;
