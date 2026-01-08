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
import Invoice from "../models/Invoice.js";
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
    const mapped = sold.map((s) => ({
      id: s._id, // ✅ IMPORTANT
      inventoryItem: s.inventoryItem,
      price: s.price,
      currency: s.currency,
      buyer: s.buyer,
      soldDate: s.soldDate,
      createdAt: s.createdAt,
    }));
    res.json({
      success: true,
      data: mapped,
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
    const record = await Sold.findById(req.params.id).populate({
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

    if (inventory.status === "sold") {
      return res.status(400).json({
        success: false,
        message: "This inventory item is already sold",
      });
    }

    if (inventory.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Only approved inventory items can be sold",
      });
    }

    const alreadySold = await Sold.findOne({
      inventoryItem: inventory._id,
    });

    if (alreadySold) {
      return res.status(400).json({
        success: false,
        message: "Sale record already exists for this item",
      });
    }

    /* ---------- UPDATE INVENTORY ---------- */
    inventory.status = "sold";
    await inventory.save();

    /* ---------- CREATE SOLD (ONLY ONCE) ---------- */
    const sold = await Sold.create({
      inventoryItem: inventory._id,
      price,
      currency,
      soldDate,
      buyer,
    });

    /* ---------- CREATE INVOICE ---------- */
    await Invoice.create({
      soldItem: sold._id,
      invoiceNumber: `INV-${Date.now()}`,
      buyer,
      currency,
      amount: price,
    });

    /* ---------- RESPONSE ---------- */
    res.status(201).json({
      success: true,
      data: sold,
    });
  } catch (err) {
    console.error("Record sale error:", err);
    next(err);
  }
}
/* =========================
   UNDO SOLD → BACK TO INVENTORY
========================= */

export async function undoSold(req, res, next) {
  try {
    const { id } = req.params;

    const sold = await Sold.findById(id);
    if (!sold) {
      return res.status(404).json({
        success: false,
        message: "Sold item not found",
      });
    }

    // revert inventory
    await Inventory.findByIdAndUpdate(sold.inventoryItem, {
      status: "approved",
    });

    // delete invoice
    await Invoice.findOneAndDelete({ soldItem: sold._id });

    // delete sold record
    await sold.deleteOne();

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// export async function undoSold(req, res, next) {
//   try {
//     const { id } = req.params;

//     // 🔍 find sold record
//     const sold = await Sold.findById(id);

//     if (!sold) {
//       return res.status(404).json({
//         message: "Sold record not found",
//       });
//     }

//     // 🔍 find inventory
//     const inventory = await Inventory.findById(sold.inventoryItem);

//     if (!inventory) {
//       return res.status(404).json({
//         message: "Inventory item not found",
//       });
//     }

//     // 🔁 revert inventory status
//     inventory.status = "approved";
//     await inventory.save();

//     // ❌ delete sold record
//     await Sold.findByIdAndDelete(id);

//     res.json({
//       success: true,
//       message: "Sale undone successfully",
//     });
//   } catch (err) {
//     next(err);
//   }
// }

/* =========================
   UPDATE SOLD ITEM
========================= */

export async function updateSold(req, res, next) {
  try {
    const { id } = req.params;
    const { price, soldDate, buyer } = req.body;

    const sold = await Sold.findById(id);
    if (!sold) {
      return res.status(404).json({ message: "Sold item not found" });
    }

    sold.price = price;
    sold.soldDate = soldDate;
    sold.buyer = buyer;

    await sold.save();

    await Invoice.findOneAndUpdate(
      { soldItem: sold._id },
      {
        amount: price,
        buyer,
      }
    );

    res.json({
      success: true,
      data: sold,
    });
  } catch (err) {
    next(err);
  }
}

// export async function updateSold(req, res, next) {
//   try {
//     const { id } = req.params;
//     const { price, soldDate, buyer } = req.body;

//     if (!price || !soldDate) {
//       return res.status(400).json({
//         message: "Price and sold date are required",
//       });
//     }

//     const sold = await Sold.findById(id);

//     if (!sold) {
//       return res.status(404).json({
//         message: "Sold record not found",
//       });
//     }

//     sold.price = price;
//     sold.soldDate = soldDate;
//     sold.buyer = buyer;

//     await sold.save();

//     res.json({
//       success: true,
//       data: sold,
//     });
//   } catch (err) {
//     next(err);
//   }
// }

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
