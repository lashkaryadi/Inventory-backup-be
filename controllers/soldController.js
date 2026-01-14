import Sold from "../models/soldModel.js";
import Invoice from "../models/Invoice.js";
import Inventory from "../models/inventoryModel.js";
import AuditLog from "../models/auditLogModel.js";
import Company from "../models/companyModel.js";
import { sendInvoiceEmail } from "../utils/emailService.js";
import { generateExcel } from "../utils/excel.js";
import { getNextInvoiceNumber } from "../utils/invoiceNumber.js";

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
  const query = { ownerId: req.user.ownerId };

  // Apply search filter
  if (search) {
    const regex = new RegExp(search, "i");

    // Search across related inventory fields by first finding matching inventory items
    const inventoryMatches = await Inventory.find({
      $or: [
        { serialNumber: regex },
        ...(isNaN(search) ? [] : [{ weight: Number(search) }, { pieces: Number(search) }])
      ],
      ownerId: req.user.ownerId
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
    soldPieces: s.soldPieces,
    soldWeight: s.soldWeight,
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
    const record = await Sold.findOne({
      _id: req.params.id,
      ownerId: req.user.ownerId
    }).populate({
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
   MARK AS SOLD (WITH PARTIAL QUANTITY SUPPORT)
========================= */

export const markAsSold = async (req, res) => {
  const session = await Inventory.startSession();
  session.startTransaction();

  try {
    const {
      inventoryId,
      soldPieces,
      soldWeight,
      price,
      currency,
      soldDate,
      buyer,
    } = req.body;

    if (
      !inventoryId ||
      soldPieces == null ||
      soldWeight == null ||
      price == null ||
      !currency ||
      !soldDate
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const inventory = await Inventory.findOne({
      _id: inventoryId,
      ownerId: req.user.ownerId,
      isDeleted: { $ne: true },
    }).session(session);

    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: "Inventory item not found",
      });
    }

    // ✅ ALLOWED STATUSES
    if (!["in_stock", "pending", "partially_sold"].includes(inventory.status)) {
      return res.status(400).json({
        success: false,
        message: "This item cannot be sold",
      });
    }

    // 🔐 Oversell protection
    if (soldPieces > inventory.availablePieces) {
      return res.status(400).json({
        success: false,
        message: "Sold pieces exceed available stock",
      });
    }

    if (soldWeight > inventory.availableWeight) {
      return res.status(400).json({
        success: false,
        message: "Sold weight exceeds available stock",
      });
    }

    // ✅ Create sold record
    const sold = await Sold.create(
      [{
        inventoryItem: inventory._id,
        soldPieces,
        soldWeight,
        price,
        totalPrice: price,
        currency,
        buyer,
        soldDate,
        ownerId: req.user.ownerId,
      }],
      { session }
    );

    // ✅ Update inventory
    inventory.availablePieces -= soldPieces;
    inventory.availableWeight -= soldWeight;

    if (inventory.availablePieces === 0 && inventory.availableWeight === 0) {
      inventory.status = "sold";
    } else {
      inventory.status = "partially_sold";
    }

    await inventory.save({ session });

    // ✅ CREATE AUDIT LOG ENTRY
    await AuditLog.create({
      action: "CREATE_SALE",
      entityType: "sold",
      entityId: sold[0]._id,
      performedBy: req.user.id,
      meta: {
        serialNumber: inventory.serialNumber,
        soldPieces,
        soldWeight,
        price,
        currency,
        soldDate,
        buyer,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      ownerId: req.user.ownerId,
    });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      data: sold[0],
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error("markAsSold error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to mark item as sold",
    });
  }
};

/* =========================
   RECORD SALE (FOR FULL ITEM SALES)
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

    const inventory = await Inventory.findOne({
      _id: inventoryId,
      ownerId: req.user.ownerId,
    });

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

    const ALLOWED_TO_SELL = ["in_stock", "pending", "partially_sold"];

    if (!ALLOWED_TO_SELL.includes(inventory.status)) {
      return res.status(400).json({
        success: false,
        message: "Only In Stock, Pending, or Partially Sold items can be sold",
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
    // ✅ Calculate cost and profit (using default cost of 0 since purchasePrice removed)
    const cost = 0; // Removed purchasePrice calculation
    const profit = price - cost;

    // For full sales, soldPieces and soldWeight equal the available amounts
    const sold = await Sold.create({
      inventoryItem: inventory._id,
      soldPieces: inventory.availablePieces,  // Full quantity
      soldWeight: inventory.availableWeight,  // Full weight
      totalPrice: price,
      price: price,
      currency,
      soldDate,
      buyer,
      costPrice: cost,
      profit,
      ownerId: req.user.ownerId,
    });

    // Update inventory to reflect sold status
    inventory.availablePieces = 0;
    inventory.availableWeight = 0;
    inventory.status = "sold";
    await inventory.save();

    /* ---------- CREATE INVOICE ---------- */
    const company = await Company.findOne({ ownerId: req.user.ownerId });
    const taxRate = company?.taxRate || 0;

    const cgst = taxRate / 2;
    const sgst = taxRate / 2;

    const cgstAmount = (price * cgst) / 100;
    const sgstAmount = (price * sgst) / 100;

    const taxAmount = cgstAmount + sgstAmount;
    const totalAmount = price + taxAmount;

    const invoice = await Invoice.create({
      invoiceNumber: await getNextInvoiceNumber(),
      buyer,
      currency,

      items: [
        {
          soldId: sold._id,
          serialNumber: inventory.serialNumber,
          category: inventory.category?.name || "-",
          weight: inventory.weight,
          weightUnit: inventory.weightUnit,
          pieces: inventory.pieces,
          price,
          currency,
          amount: price,
        },
      ],

      subtotal: price,
      taxRate,
      taxType: "cgst_sgst", // Default to CGST/SGST for intrastate
      cgstAmount,
      sgstAmount,
      taxAmount,
      totalAmount,
      ownerId: req.user.ownerId,
    });

    /* ---------- AUDIT LOG ---------- */
    await AuditLog.create({
      action: "SELL_ITEM",
      entityType: "inventory",
      entityId: inventory._id,
      performedBy: req.user.id,
      meta: {
        serialNumber: inventory.serialNumber,
        salePrice: price,
        currency,
        soldDate,
        buyer,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      ownerId: req.user.ownerId,
    });

    /* ---------- SEND INVOICE EMAIL ---------- */
    if (buyer) {
      await sendInvoiceEmail(buyer, invoice.invoiceNumber);
    }

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

    const sold = await Sold.findOne({
      _id: id,
      ownerId: req.user.ownerId
    });
    if (!sold) {
      return res.status(404).json({
        success: false,
        message: "Sold item not found",
      });
    }

    // revert inventory - we'll set it back to "approved" as the default state for items that can be sold again
    // In a more sophisticated system, we might track the original status before selling
    const inventory = await Inventory.findById(sold.inventoryItem);
    inventory.availablePieces += sold.soldPieces;
    inventory.availableWeight += sold.soldWeight;

    // Only change status back to in_stock if the inventory isn't fully sold anymore
    if (inventory.availablePieces > 0 && inventory.availableWeight > 0) {
      inventory.status = "in_stock";
    } else {
      inventory.status = "sold"; // Still fully sold
    }

    await inventory.save();

    // delete invoice (handle both old and new formats)
    await Invoice.findOneAndDelete({
      $or: [
        { "items.soldId": sold._id },
        { soldItem: sold._id }
      ]
    });

    // delete sold record
    await sold.deleteOne();

    /* ---------- AUDIT LOG ---------- */
    await AuditLog.create({
      action: "UNDO_SOLD",
      entityType: "sold",
      entityId: sold._id,
      performedBy: req.user.id,
      meta: {
        serialNumber: sold.inventoryItem?.serialNumber,
      },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      ownerId: req.user.ownerId,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/* =========================
   EXPORT SOLD ITEMS TO EXCEL
========================= */

export const exportSoldItemsToExcel = async (req, res) => {
  try {
    const soldItems = await Sold.find({ ownerId: req.user.ownerId })
      .populate({
        path: "inventoryItem",
        populate: { path: "category" },
      })
      .sort({ createdAt: -1 });

    const data = soldItems.map((s) => ({
      SerialNumber: s.inventoryItem?.serialNumber,
      Category: s.inventoryItem?.category?.name,
      SoldPieces: s.soldPieces,
      SoldWeight: `${s.soldWeight} ${s.inventoryItem?.weightUnit || ''}`,
      OriginalPieces: s.inventoryItem?.totalPieces,
      OriginalWeight: `${s.inventoryItem?.totalWeight} ${s.inventoryItem?.weightUnit || ''}`,
      SalePrice: `${s.currency} ${s.totalPrice || s.price}`,
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

// ❌ REMOVED: Update sold feature disabled to prevent accounting bugs
// export async function updateSold(req, res, next) { ... }