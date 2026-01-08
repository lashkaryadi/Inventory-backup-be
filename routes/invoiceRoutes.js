import express from "express";
import { generateInvoice, getInvoiceBySold} from "../controllers/invoiceController.js";
import { protect } from "../middleware/authMiddleware.js";
import { downloadInvoicePDF } from "../controllers/invoiceController.js";



const router = express.Router();

router.post("/generate", protect, generateInvoice);
router.get("/sold/:soldId", protect, getInvoiceBySold);
router.get("/:id/pdf", protect, downloadInvoicePDF);


export default router;
