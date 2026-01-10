import express from "express";
import {
  getAuditLogs,
  exportAuditLogs,
} from "../controllers/auditLogController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getAuditLogs);
router.get("/export", protect, exportAuditLogs);

export default router;
