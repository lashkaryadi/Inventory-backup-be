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
import AuditLog from "../models/auditLogModel.js";
import { generateExcel } from "../utils/excel.js";

/* =========================
   GET ALL SOLD
========================= */
export const getSoldItems = async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);
  const skip = (page - 1) * limit;

  // Extract query parameters
  const { search = "", sortBy = "createdAt", sortOrder = "desc" } = req.query;

  // Build query object
  const query = {};

  // Apply search filter
  if (search) {
    const regex = new RegExp(search, "i");

    // Search across related inventory fields by first finding matching inventory items
    const inventoryMatches = await Inventory.find({
      $or: [
        { serialNumber: regex },
        ...(isNaN(search) ? [] : [{ weight: Number(search) }, { pieces: Number(search) }])
      ]
    }).select('_id');

    const inventoryIds = inventoryMatches.map(item => item._id);

    // Then find sold items that match either the inventory IDs or other fields
    query.$or = [
      { buyer: regex },
      ...(isNaN(search) ? [] : [{ price: Number(search) }]),
      ...(inventoryIds.length > 0 ? [{ "inventoryItem": { $in: inventoryIds } }] : [])
    ];
  }

  // Determine sort order
  const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

  const [items, total] = await Promise.all([
    Sold.find(query)
      .populate({
        path: "inventoryItem",
        populate: { path: "category" },
      })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Sold.countDocuments(query),
  ]);

  const safeSold = items.filter((s) => s.inventoryItem !== null);

  const mapped = safeSold.map((s) => ({
    id: s._id,
    inventoryItem: s.inventoryItem,
    price: s.price,
    currency: s.currency,
    buyer: s.buyer,
    soldDate: s.soldDate,
    createdAt: s.createdAt,
  }));

  res.json({
    data: mapped,
    meta: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
};

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

    const ALLOWED_TO_SELL = ["in_stock", "pending"];

    if (!ALLOWED_TO_SELL.includes(inventory.status)) {
      return res.status(400).json({
        success: false,
        message: "Only In Stock or pending items can be sold",
      });
    }

    if (inventory.status === "sold") {
      return res.status(400).json({
        success: false,
        message: "Item already sold",
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

    /* ---------- AUDIT LOG ---------- */
    await AuditLog.create({
      action: "SELL_ITEM",
      entityType: "inventory",
      entityId: inventory._id,
      performedBy: req.user._id,
      meta: {
        serialNumber: inventory.serialNumber,
        salePrice: price,
        currency,
        soldDate,
        buyer,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
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

    // revert inventory - we'll set it back to "approved" as the default state for items that can be sold again
    // In a more sophisticated system, we might track the original status before selling
    await Inventory.findByIdAndUpdate(sold.inventoryItem, {
      status:"in_stock",
    });

    // delete invoice
    await Invoice.findOneAndDelete({ soldItem: sold._id });

    // delete sold record
    await sold.deleteOne();

    /* ---------- AUDIT LOG ---------- */
    await AuditLog.create({
      action: "UNDO_SOLD",
      entityType: "sold",
      entityId: sold._id,
      performedBy: req.user._id,
      meta: {
        serialNumber: sold.inventoryItem?.serialNumber,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

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
   EXPORT SOLD ITEMS TO EXCEL
========================= */

export const exportSoldItemsToExcel = async (req, res) => {
  try {
    const soldItems = await Sold.find()
      .populate({
        path: "inventoryItem",
        populate: { path: "category" },
      })
      .sort({ createdAt: -1 });

    const data = soldItems.map((s) => ({
      SerialNumber: s.inventoryItem?.serialNumber,
      Category: s.inventoryItem?.category?.name,
      Weight: `${s.inventoryItem?.weight} ${s.inventoryItem?.weightUnit}`,
      SalePrice: `${s.currency} ${s.price}`,
      Buyer: s.buyer || "-",
      SoldDate: s.soldDate ? new Date(s.soldDate).toLocaleDateString() : "-",
      Status: s.inventoryItem?.status || "-",
    }));

    const file = generateExcel(data);

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=sold-items.xlsx"
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.send(file);
  } catch (err) {
    console.error("Export sold items error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to export sold items",
    });
  }
};

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

    const before = sold.toObject();

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

    /* ---------- AUDIT LOG ---------- */
    await AuditLog.create({
      action: "UPDATE_SOLD",
      entityType: "sold",
      entityId: sold._id,
      performedBy: req.user._id,
      meta: {
        before,
        after: sold.toObject(),
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

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
