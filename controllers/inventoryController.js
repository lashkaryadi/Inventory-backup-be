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
import Category from "../models/category.js";

const upload = multer({ storage: multer.memoryStorage() });
export const importMiddleware = upload.single("file");

export const previewInventoryExcel = async (req, res) => {
  try {
    const rows = parseExcel(req.file.buffer);

    const preview = [];

    for (const row of rows) {
      const exists = await Inventory.findOne({
        serialNumber: row.serialNumber,
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
    { _id: { $in: ids } },
    { $set: updates }
  );

  res.json({
    success: true,
    message: "Bulk update successful",
  });
};

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
  pieces: row.pieces,
  weight: row.weight,
  weightUnit: row.weightUnit || "carat",
  purchaseCode: row.purchaseCode,
  saleCode: row.saleCode,
  status: row.status || "pending",

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
  const items = await Inventory.find()
    .populate("category", "name")
    .sort({ createdAt: -1 });

  res.json(items);
};

/* CREATE */
export const createInventoryItem = async (req, res, next) => {
  try {
    const {
      serialNumber,
      category,
      pieces,
      weight,
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

    if (
      !serialNumber ||
      !category ||
      !pieces ||
      !weight ||
      !weightUnit ||
      !purchaseCode ||
      !saleCode
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const item = await Inventory.create({
      serialNumber,
      category,
      pieces,
      weight,
      weightUnit,
      purchaseCode,
      saleCode,
      dimensions, // 🔥 IMPORTANT
      location,
      certification,
      status,
      description,
      images,
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

   const updated = await Inventory.findByIdAndUpdate(
  id,
  {
    ...req.body,
    dimensions: req.body.dimensions, // 🔥 FORCE SAVE
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

    const inventory = await Inventory.findById(id);
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
