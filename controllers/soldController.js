// import * as Sold from '../models/soldModel.js';

// export function getAllSold(req, res, next) {
//   try {
//     const sold = Sold.getAll();
//     res.json(sold);
//   } catch (err) {
//     next(err);
//   }
// }

// export function getSoldById(req, res, next) {
//   try {
//     const record = Sold.getById(req.params.id);
//     if (!record) return res.status(404).json({ message: 'Record not found' });
//     res.json(record);
//   } catch (err) {
//     next(err);
//   }
// }

// export function recordSale(req, res, next) {
//   try {
//     const created = Sold.create(req.body);
//     res.status(201).json(created);
//   } catch (err) {
//     next(err);
//   }
// }
import Sold from "../models/soldModel.js";
import Inventory from "../models/inventoryModel.js";

/* =========================
   GET ALL SOLD
========================= */
export async function getAllSold(req, res, next) {
  try {
    const sold = await Sold.find()
      .populate({
        path: "inventoryItem",
        populate: { path: "category" },
      })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: sold,
    });
  } catch (err) {
    next(err);
  }
}


/* =========================
   GET SOLD BY ID
========================= */
export async function getSoldById(req, res, next) {
  try {
    const record = await Sold.findById(req.params.id)
      .populate({
        path: "inventoryItem",
        populate: { path: "category" },
      });

    if (!record) {
      return res.status(404).json({ message: "Record not found" });
    }

    res.json(record);
  } catch (err) {
    next(err);
  }
}

/* =========================
   RECORD SALE
========================= */
export async function recordSale(req, res, next) {
  try {
    const { inventoryId, price, currency, soldDate, buyer } = req.body;

    if (!inventoryId || !price || !currency || !soldDate) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const inventory = await Inventory.findById(inventoryId);

    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: "Inventory item not found",
      });
    }

    // ❌ BLOCK RESELL
    if (inventory.status === "sold") {
      return res.status(400).json({
        success: false,
        message: "This inventory item is already sold",
      });
    }

    // ❌ ONLY APPROVED CAN BE SOLD
    if (inventory.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Only approved inventory items can be sold",
      });
    }

    // ❌ DOUBLE SAFETY — Sold collection check
    const alreadySold = await Sold.findOne({
      inventoryItem: inventory._id,
    });

    if (alreadySold) {
      return res.status(400).json({
        success: false,
        message: "Sale record already exists for this item",
      });
    }

    // ✅ UPDATE INVENTORY
    inventory.status = "sold";
    await inventory.save();

    // ✅ CREATE SOLD ENTRY
    const created = await Sold.create({
      inventoryItem: inventory._id,
      price,
      currency,
      soldDate,
      buyer,
    });

    res.status(201).json({
      success: true,
      data: created,
    });
  } catch (err) {
    console.error("Record sale error:", err);
    next(err);
  }
}

// export async function markAsSold(req, res, next) {
//   try {
//     const { inventoryId, price, currency, soldDate, buyer } = req.body;

//     if (!inventoryId || !price || !currency || !soldDate) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     const inventory = await Inventory.findById(inventoryId);
//     if (!inventory) {
//       return res.status(404).json({ message: "Inventory item not found" });
//     }

//     if (inventory.status !== "approved") {
//       return res
//         .status(400)
//         .json({ message: "Only approved inventory items can be sold" });
//     }

//     inventory.status = "sold";
//     await inventory.save();

//     const sold = await Sold.create({
//       inventoryItem: inventory._id,
//       price,
//       currency,
//       soldDate,
//       buyer,
//     });

//     res.status(201).json({
//       success: true,
//       data: sold,
//     });
//   } catch (err) {
//     next(err);
//   }
// }
