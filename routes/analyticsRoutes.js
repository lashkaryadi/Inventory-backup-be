import express from "express";
import { getProfitAnalytics, getMonthlyProfitAnalytics, getCategoryProfitAnalytics, exportProfitExcel } from "../controllers/analyticsController.js";
import { protect, adminOnly } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/profit", protect, adminOnly, getProfitAnalytics);
router.get("/monthly-profit", protect, adminOnly, getMonthlyProfitAnalytics);
router.get("/category-profit", protect, adminOnly, getCategoryProfitAnalytics);
router.get("/profit/export", protect, adminOnly, exportProfitExcel);

export default router;
