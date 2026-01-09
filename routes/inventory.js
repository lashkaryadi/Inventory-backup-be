// import express from "express";
// import {
//   getAllItems,
//   createItem,
//   updateItem,
//   deleteItem,

// } from "../controllers/inventoryController.js";

// import { protect } from "../middleware/authMiddleware.js";

// const router = express.Router();

// router.get("/", protect, getAllItems);
// router.post("/", protect, createItem);
// router.put("/:id", protect, updateItem);
// router.delete("/:id", protect, deleteItem);

// export default router;

import express from "express";
import {
  getInventory,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  importInventoryFromExcel,
  exportInventoryToExcel,
  importMiddleware,
  bulkUpdateInventory,
  downloadImportReport,
} from "../controllers/inventoryController.js";
import { previewInventoryExcel } from "../controllers/inventoryController.js";

import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getInventory);
router.post("/", protect, createInventoryItem);
router.put("/:id", protect, updateInventoryItem);
router.delete("/:id", protect, deleteInventoryItem);
router.post("/import", protect, importMiddleware, importInventoryFromExcel);
router.get("/export", protect, exportInventoryToExcel);
router.post("/import/preview", protect, importMiddleware, previewInventoryExcel);
router.post("/import/confirm", protect, importInventoryFromExcel);
router.post("/import/report", protect, downloadImportReport);
router.put("/bulk-update", protect, bulkUpdateInventory);


export default router;
