// import express from 'express';
// import * as soldController from '../controllers/soldController.js';

// const router = express.Router();

// router.get('/', soldController.getAllSold);
// router.get('/:id', soldController.getSoldById);
// router.post('/', soldController.recordSale);

// export default router;

import express from "express";
import {
  getAllSold,
  getSoldById,
  recordSale,
} from "../controllers/soldController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getAllSold);
router.get("/:id", protect, getSoldById);
router.post("/", protect, recordSale);

export default router;
