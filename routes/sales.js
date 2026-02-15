import express from 'express';
import {
  sellInventory,
  undoSale,
  getAllSales,
  getSaleById,
  exportSalesExcel
} from '../controllers/saleController.js';
import { protect } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/role.js';

const router = express.Router();

// Export sales to Excel (must be before /:id route)
router.get('/export/excel', protect, exportSalesExcel);

// Get all sales
router.get('/', protect, getAllSales);

// Get single sale
router.get('/:id', protect, getSaleById);

// Sell inventory (admin and staff)
router.post('/sell', protect, requireRole(['admin', 'staff']), sellInventory);

// Undo sale (admin only)
router.post('/:id/undo', protect, requireRole(['admin']), undoSale);

export default router;
