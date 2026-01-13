import express from "express";
import {
  getAuditLogs,
  exportAuditLogs,
  clearAuditLogs,
} from "../controllers/auditLogController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getAuditLogs);
router.get("/export", protect, exportAuditLogs);
router.delete("/clear", protect, clearAuditLogs);

export default router;
