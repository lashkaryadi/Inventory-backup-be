// import * as Inventory from '../models/inventoryModel.js';

// export function getAllItems(req, res, next) {
//   try {
//     const items = Inventory.getAll();
//     res.json(items);
//   } catch (err) {
//     next(err);
//   }
// }

// export function getItemById(req, res, next) {
//   try {
//     const item = Inventory.getById(req.params.id);
//     if (!item) return res.status(404).json({ message: 'Item not found' });
//     res.json(item);
//   } catch (err) {
//     next(err);
//   }
// }

// export function createItem(req, res, next) {
//   try {
//     const created = Inventory.create(req.body);
//     res.status(201).json(created);
//   } catch (err) {
//     if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
//       err.status = 409;
//       err.message = 'Serial Number must be unique';
//     }
//     next(err);
//   }
// }

// export function updateItem(req, res, next) {
//   try {
//     const changes = Inventory.update(req.params.id, req.body);
//     if (changes === 0) return res.status(404).json({ message: 'Item not found' });
//     res.json({ message: 'Item updated' });
//   } catch (err) {
//     next(err);
//   }
// }

// export function deleteItem(req, res, next) {
//   try {
//     const changes = Inventory.remove(req.params.id);
//     if (changes === 0) return res.status(404).json({ message: 'Item not found' });
//     res.json({ message: 'Item deleted' });
//   } catch (err) {
//     next(err);
//   }
// }

import Sold from "../models/soldModel.js";
import Invoice from "../models/Invoice.js";
import multer from "multer";
import Inventory from "../models/inventoryModel.js";
import { generateValidationReport } from "../utils/excel.js";
import { parseExcel, generateExcel } from "../utils/excel.js";
import Category from "../models/Category.js";
import mongoose from "mongoose";


const upload = multer({ storage: multer.memoryStorage() });
export const importMiddleware = upload.single("file");

export const previewInventoryExcel = async (req, res) => {
  try {
    const rows = parseExcel(req.file.buffer);

    const preview = [];

    for (const row of rows) {
      const exists = await Inventory.findOne({
        serialNumber: row.serialNumber,
        ownerId: req.user.ownerId,
      });

      preview.push({
        ...row,
        isDuplicate: !!exists,
        isValid:
          row.serialNumber &&
          row.category &&
          row.pieces &&
          row.weight &&
          row.purchaseCode &&
          row.saleCode,
      });
    }

    res.json({
      success: true,
      data: preview,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to preview excel",
    });
  }
};

export const bulkUpdateInventory = async (req, res) => {
  const { ids, updates } = req.body;

  if (!ids?.length || !updates) {
    return res.status(400).json({
      success: false,
      message: "Invalid bulk update payload",
    });
  }

  await Inventory.updateMany(
    { _id: { $in: ids }, ownerId: req.user.ownerId },
    { $set: updates }
  );

  res.json({
    success: true,
    message: "Bulk update successful",
  });
};

// Separate function for import with duplicate checking (for direct import)
export const importInventoryFromExcel = async (req, res) => {
  try {
    const rows = parseExcel(req.file.buffer);

    let inserted = 0;
    let skipped = 0;
    const report = [];

   for (const row of rows) {
  // BASIC VALIDATION
  if (
    !row.serialNumber ||
    !row.category ||
    !row.pieces ||
    !row.weight ||
    !row.purchaseCode ||
    !row.saleCode
  ) {
    skipped++;
    report.push({ ...row, status: "INVALID" });
    continue;
  }

  // CATEGORY NAME → ID
  const categoryDoc = await Category.findOne({
    name: new RegExp(`^${row.category}$`, "i"),
  });

  if (!categoryDoc) {
    skipped++;
    report.push({ ...row, status: "INVALID", reason: "Category not found" });
    continue;
  }

  // DUPLICATE CHECK
  const exists = await Inventory.findOne({
    serialNumber: row.serialNumber,
    ownerId: req.user.ownerId,
  });

  if (exists) {
    skipped++;
    report.push({ ...row, status: "DUPLICATE" });
    continue;
  }

  // INSERT
  await Inventory.create({
  serialNumber: row.serialNumber,
  category: categoryDoc._id,
  totalPieces: row.pieces,
  availablePieces: row.pieces, // Initially available = total
  totalWeight: row.weight,
  availableWeight: row.weight, // Initially available = total
  weightUnit: row.weightUnit || "carat",
  purchaseCode: row.purchaseCode,
  saleCode: row.saleCode,
  status: row.status || "pending",
  ownerId: req.user.ownerId, // 🔥 REQUIRED

  dimensions: {
    length: row.length,
    width: row.width,
    height: row.height,
    unit: row.dimensionUnit || "mm",
  },
});


  inserted++;
  report.push({ ...row, status: "INSERTED" });
}


    res.json({
      success: true,
      inserted,
      skipped,
      report,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Import failed",
    });
  }
};

// Separate function for confirmed import (skips duplicate checking)
export const confirmInventoryImport = async (req, res) => {
  try {
    const rows = parseExcel(req.file.buffer);

    let inserted = 0;
    let skipped = 0;
    const report = [];

   for (const row of rows) {
  // BASIC VALIDATION (same as above)
  if (
    !row.serialNumber ||
    !row.category ||
    !row.pieces ||
    !row.weight ||
    !row.purchaseCode ||
    !row.saleCode
  ) {
    skipped++;
    report.push({ ...row, status: "INVALID" });
    continue;
  }

  // CATEGORY NAME → ID
  const categoryDoc = await Category.findOne({
    name: new RegExp(`^${row.category}$`, "i"),
  });

  if (!categoryDoc) {
    skipped++;
    report.push({ ...row, status: "INVALID", reason: "Category not found" });
    continue;
  }

  // INSERT (SKIP DUPLICATE CHECK - USER HAS REVIEWED PREVIEW)
  await Inventory.create({
  serialNumber: row.serialNumber,
  category: categoryDoc._id,
  totalPieces: row.pieces,
  availablePieces: row.pieces, // Initially available = total
  totalWeight: row.weight,
  availableWeight: row.weight, // Initially available = total
  weightUnit: row.weightUnit || "carat",
  purchaseCode: row.purchaseCode,
  saleCode: row.saleCode,
  status: row.status || "pending",
  ownerId: req.user.ownerId, // 🔥 REQUIRED

  dimensions: {
    length: row.length,
    width: row.width,
    height: row.height,
    unit: row.dimensionUnit || "mm",
  },
});


  inserted++;
  report.push({ ...row, status: "INSERTED" });
}


    res.json({
      success: true,
      inserted,
      skipped,
      report,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Import failed",
    });
  }
};


export const exportInventoryToExcel = async (req, res) => {
  const inventory = await Inventory.find().populate("category");

  const data = inventory.map((i) => ({
    serialNumber: i.serialNumber,
    category: i.category?.name,
    pieces: i.pieces,
    weight: i.weight,
    weightUnit: i.weightUnit,
    purchaseCode: i.purchaseCode,
    saleCode: i.saleCode,
    status: i.status,
  }));

  const file = generateExcel(data);

  res.setHeader("Content-Disposition", "attachment; filename=inventory.xlsx");
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.send(file);
};

/* GET ALL */
export const getInventory = async (req, res) => {
  try {
   const {
  search = "",
  category,
  status,
  page = 1,
  limit = 20,
  sortBy,
  sortOrder,
} = req.query;

const sortField = sortBy || "createdAt";
const sortDir = sortOrder === "asc" ? 1 : -1;

const sortQuery = { [sortField]: sortDir };

    const query = {
      ownerId: req.user.ownerId,
      isDeleted: false,
    };

    /* 🔍 SEARCH */
    if (search) {
      query.$or = [
        { serialNumber: { $regex: search, $options: "i" } },
        { purchaseCode: { $regex: search, $options: "i" } },
        { saleCode: { $regex: search, $options: "i" } },
        { certification: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
      ];
    }

    /* 📦 CATEGORY FILTER */
    

if (category && mongoose.Types.ObjectId.isValid(category)) {
  query.category = category;
}

    /* 📌 STATUS FILTER */
    if (status && status !== "all") {
      if (status === "partially_sold") {
        query.status = "partially_sold";
      } else {
        query.status = status;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    /* 🔃 SORTING */
// const sortField = req.query.sortBy || "createdAt";
// const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

// const sortQuery = { [sortField]: sortOrder };

    const [items, total] = await Promise.all([
      Inventory.find(query)
        .populate("category", "name")
        .sort(sortQuery)
        .skip(skip)
        .limit(Number(limit)),
      Inventory.countDocuments(query),
    ]);

    res.json({
      data: items,
      meta: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Inventory fetch error:", err);
    res.status(500).json({ message: "Failed to fetch inventory" });
  }
};


/* CREATE */
export const createInventoryItem = async (req, res, next) => {
  try {
    const {
      serialNumber,
      category,
      pieces,
      weight,
      totalPieces,
      totalWeight,
      weightUnit,
      purchaseCode,
      saleCode,
      dimensions,
      location,
      certification,
      status,
      description,
      images,
    } = req.body;

    // ✅ Normalize payload (frontend safety)
    const finalPieces = Number(pieces ?? totalPieces);
    const finalWeight = Number(weight ?? totalWeight);

    if (
      !serialNumber ||
      !category ||
      !finalPieces ||
      !finalWeight ||
      !weightUnit ||
      !purchaseCode ||
      !saleCode
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const ownerId = req.user.ownerId;

    const item = await Inventory.create({
      serialNumber,
      category,
      totalPieces: finalPieces,
      availablePieces: finalPieces,
      totalWeight: finalWeight,
      availableWeight: finalWeight,
      weightUnit,
      purchaseCode,
      saleCode,
      dimensions,
      location,
      certification,
      status,
      description,
      images,
      ownerId,
    });

    res.status(201).json({
      success: true,
      data: item,
    });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.serialNumber) {
      return res.status(409).json({
        success: false,
        message: "Inventory item with this serial number already exists",
        field: "serialNumber",
      });
    }

    next(err);
  }
};


/* UPDATE */
// export const updateInventoryItem = async (req, res) => {
//   const item = await Inventory.findByIdAndUpdate(
//     req.params.id,
//     req.body,
//     { new: true }
//   );

//   if (!item) {
//     return res.status(404).json({ message: "Item not found" });
//   }

//   res.json(item);
// };
export const updateInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;

   // Handle the new schema fields properly
   const updateData = { ...req.body };

   // If pieces or weight are being updated, update total and available accordingly
   if (updateData.pieces !== undefined) {
     updateData.totalPieces = updateData.pieces;
     // Only update availablePieces if it's not already set separately
     if (updateData.availablePieces === undefined) {
       updateData.availablePieces = updateData.pieces;
     }
     // Remove the old field to avoid conflicts
     delete updateData.pieces;
   }

   if (updateData.weight !== undefined) {
     updateData.totalWeight = updateData.weight;
     // Only update availableWeight if it's not already set separately
     if (updateData.availableWeight === undefined) {
       updateData.availableWeight = updateData.weight;
     }
     // Remove the old field to avoid conflicts
     delete updateData.weight;
   }

   const updated = await Inventory.findOneAndUpdate(
  {
    _id: id,
    ownerId: req.user.ownerId
  },
  {
    ...updateData,
    dimensions: updateData.dimensions, // 🔥 FORCE SAVE
  },
  {
    new: true,
    runValidators: true,
  }
);


    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Inventory item not found",
      });
    }

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    // 🔥 DUPLICATE SERIAL NUMBER HANDLING
    if (error.code === 11000 && error.keyPattern?.serialNumber) {
      return res.status(409).json({
        success: false,
        message: "Serial number already exists",
        field: "serialNumber",
      });
    }

    console.error("Update inventory error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update inventory item",
    });
  }
};

/* DELETE */
export async function deleteInventoryItem(req, res, next) {
  try {
    const { id } = req.params;

    const inventory = await Inventory.findOne({
      _id: id,
      ownerId: req.user.ownerId
    });
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: "Inventory item not found",
      });
    }

    /* 🔥 FIND SOLD RECORD */
    const sold = await Sold.findOne({ inventoryItem: inventory._id });

    if (sold) {
      /* 🔥 DELETE INVOICE FIRST */
      await Invoice.findOneAndDelete({ soldItem: sold._id });

      /* 🔥 DELETE SOLD */
      await sold.deleteOne();
    }

    /* 🔥 DELETE INVENTORY */
    await inventory.deleteOne();

    res.json({
      success: true,
      message: "Inventory and related sales deleted",
    });
  } catch (err) {
    next(err);
  }
}

export const downloadImportReport = async (req, res) => {
  const buffer = generateValidationReport(req.body.rows);

  res.setHeader(
    "Content-Disposition",
    "attachment; filename=import-report.xlsx"
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.send(buffer);
};

/* =========================
   GET SELLABLE INVENTORY (in_stock, pending, and partially_sold items)
========================= */
export const getSellableInventory = async (req, res) => {
  try {
    const items = await Inventory.find({
      status: { $in: ["in_stock", "pending", "partially_sold"] },
      isDeleted: { $ne: true }, // Exclude deleted items
      ownerId: req.user.ownerId
    }).populate("category", "name").sort({ createdAt: -1 });

    res.json({
      success: true,
      data: items,
    });
  } catch (err) {
    console.error("Get sellable inventory error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sellable inventory",
    });
  }
};
