import express from "express";
import {
  getRecycleBin,
  restoreItems,
  deleteItems,
  emptyBin,
} from "../controllers/recycleBinController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getRecycleBin);
router.post("/restore", protect, (req, res, next) => {
  console.log("RESTORE HIT", req.body);
  next();
}, restoreItems);
router.delete("/delete", protect, (req, res, next) => {
  console.log("DELETE HIT", req.body);
  next();
}, deleteItems);
router.post("/empty", protect, emptyBin);

export default router;
