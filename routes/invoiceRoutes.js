import express from "express";
import {
  createBulkInvoice,
  getInvoiceBySaleId,
  getInvoiceById,
  downloadInvoicePDF,
} from "../controllers/invoiceController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Create invoice from selected sales
router.post("/bulk-create", protect, createBulkInvoice);

// Get invoice by sale ID (auto-creates if none exists)
router.get("/sold/:saleId", protect, getInvoiceBySaleId);

// Download invoice as PDF
router.get("/:id/pdf", protect, downloadInvoicePDF);

// Get invoice by ID
router.get("/:id", protect, getInvoiceById);

export default router;
