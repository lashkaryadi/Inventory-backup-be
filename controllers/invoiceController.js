import Inventory from "../models/inventoryModel.js";
import Packaging from "../models/Packaging.js";
import Invoice from "../models/Invoice.js";
import Sold from "../models/soldModel.js";
import Company from "../models/companyModel.js";
import { generateInvoicePDF } from "../utils/pdfService.js";
import Counter from "../models/Counter.js";
import mongoose from "mongoose";

// ✅ Helper function for rounding to prevent floating-point errors
const round = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

export const downloadInvoicePDF = async (req, res) => {
  try {
    // First try to find the invoice normally
    let invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    // Check if it's a new format invoice (with items array) or old format (with soldItem)
    if (invoice.items && invoice.items.length > 0) {
      // New format: populate items
      invoice = await Invoice.findById(req.params.id).populate({
        path: "items.soldId",
        populate: {
          path: "inventoryItem",
          populate: { path: "category" },
        },
      });
    } else {
      // Old format: populate soldItem
      invoice = await Invoice.findById(req.params.id).populate({
        path: "soldItem",
        populate: {
          path: "inventoryItem",
          populate: { path: "category" },
        },
      });
    }

    // Fetch company info
    const company = await Company.findOne({ ownerId: req.user.ownerId });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${invoice.invoiceNumber}.pdf`
    );

    const doc = generateInvoicePDF(invoice, company);
    doc.pipe(res);
    doc.end();
  } catch (error) {
    res.status(500).json({ message: "Failed to generate PDF" });
  }
};


async function generateInvoiceNumber(ownerId) {
  const year = new Date().getFullYear();

  // ✅ GET COMPANY NAME
  const company = await Company.findOne({ ownerId });

  // ✅ EXTRACT FIRST WORD FROM COMPANY NAME (MAX 10 CHARS)
  let prefix = "INV";
  if (company?.companyName) {
    const firstWord = company.companyName.trim().split(/\s+/)[0];
    prefix = firstWord
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "") // Remove special chars
      .substring(0, 10); // Max 10 chars
  }

  // ✅ GET COUNTER
  const counter = await Counter.findOneAndUpdate(
    { name: `invoice-${ownerId}-${year}` },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  );

  const padded = String(counter.value).padStart(5, "0");
  return `${prefix}-${year}-${padded}`;
}

// export const getInvoiceBySold = async (req, res) => {
//   const invoice = await Invoice.findOne({
//     soldItem: req.params.soldId,
//   }).populate({
//     path: "soldItem",
//     populate: {
//       path: "inventoryItem",
//       populate: { path: "category" },
//     },
//   });

//   if (!invoice) {
//     return res.status(404).json({ message: "Invoice not found" });
//   }

//   res.json(invoice);
// };
export const getInvoiceBySold = async (req, res) => {
  try {
    const soldDoc = await Sold.findOne({
      _id: req.params.soldId,
      ownerId: req.user.ownerId,
    }).populate({
      path: "inventoryItem",
      populate: { path: "category" },
    });

    if (!soldDoc) {
      return res.status(404).json({
        success: false,
        message: "Sold item not found",
      });
    }

    // ✅ TRY TO FIND EXISTING INVOICE
    let invoice = await Invoice.findOne({
      $or: [
        { "items.soldId": soldDoc._id },
        { soldItems: soldDoc._id },
        { soldItem: soldDoc._id }, // Old format
      ],
    });

    // ✅ AUTO-CREATE IF MISSING
    if (!invoice) {
      const company = await Company.findOne({ ownerId: req.user.ownerId });
      const taxRate = company?.taxRate || 0;

      const subtotal = soldDoc.totalPrice || soldDoc.price;
      const cgstAmount = (subtotal * (taxRate / 2)) / 100;
      const sgstAmount = cgstAmount;
      const totalAmount = subtotal + cgstAmount + sgstAmount;

      const invoiceNumber = await generateInvoiceNumber(req.user.ownerId);

      invoice = await Invoice.create({
        invoiceNumber,
        buyer: soldDoc.buyer,
        currency: soldDoc.currency,

        items: [
          {
            soldId: soldDoc._id,
            serialNumber: soldDoc.inventoryItem?.serialNumber || "-",
            category: soldDoc.inventoryItem?.category?.name || "-",
            soldPieces: soldDoc.soldPieces,
            soldWeight: soldDoc.soldWeight,
            weight: soldDoc.soldWeight,
            weightUnit: soldDoc.inventoryItem?.weightUnit || "carat",
            price: soldDoc.price,
            currency: soldDoc.currency,
            amount: soldDoc.totalPrice || soldDoc.price,
          },
        ],

        soldItems: [soldDoc._id],
        subtotal,
        taxRate,
        cgstAmount,
        sgstAmount,
        taxAmount: cgstAmount + sgstAmount,
        totalAmount,
        ownerId: req.user.ownerId,
      });
    }

    // ✅ POPULATE AND RETURN
    const populated = await Invoice.findById(invoice._id)
      .populate({
        path: "items.soldId",
        populate: {
          path: "inventoryItem",
          populate: { path: "category" },
        },
      })
      .populate({
        path: "soldItems",
        populate: {
          path: "inventoryItem",
          populate: { path: "category" },
        },
      });

    res.json(populated);
  } catch (error) {
    console.error("Get invoice error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch invoice",
    });
  }
};


export const createBulkInvoice = async (req, res) => {
  try {
    const { soldIds } = req.body;

    if (!soldIds || !Array.isArray(soldIds) || soldIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No sold items provided",
      });
    }

    // ✅ Remove duplicates
    const uniqueSoldIds = [...new Set(soldIds)];

    // ✅ FETCH SOLD ITEMS
    const soldItems = await Sold.find({
      _id: { $in: uniqueSoldIds },
      ownerId: req.user.ownerId,
    }).populate({
      path: "inventoryItem",
      populate: { path: "category" },
    });

    if (!soldItems.length) {
      return res.status(404).json({
        success: false,
        message: "No valid sold items found",
      });
    }

    // ✅ CALCULATE TOTALS
    const company = await Company.findOne({ ownerId: req.user.ownerId });
    const taxRate = company?.taxRate || 0;

    const subtotal = soldItems.reduce(
      (sum, s) => sum + (s.totalPrice || s.price || 0),
      0
    );

    const cgstAmount = (subtotal * (taxRate / 2)) / 100;
    const sgstAmount = cgstAmount;
    const totalAmount = subtotal + cgstAmount + sgstAmount;

    // ✅ BUILD INVOICE ITEMS
    const invoiceItems = soldItems.map((sold) => ({
      soldId: sold._id,
      serialNumber: sold.inventoryItem?.serialNumber || "-",
      category: sold.inventoryItem?.category?.name || "-",
      soldPieces: sold.soldPieces,
      soldWeight: sold.soldWeight,
      weight: sold.soldWeight,
      weightUnit: sold.inventoryItem?.weightUnit || "carat",
      price: sold.price,
      currency: sold.currency,
      amount: sold.totalPrice || sold.price,
    }));

    // ✅ GENERATE INVOICE NUMBER
    const invoiceNumber = await generateInvoiceNumber(req.user.ownerId);

    // ✅ CREATE INVOICE
    const invoice = await Invoice.create({
      invoiceNumber,
      buyer: soldItems[0].buyer,
      currency: soldItems[0].currency,
      items: invoiceItems,
      soldItems: uniqueSoldIds,
      subtotal,
      taxRate,
      cgstAmount,
      sgstAmount,
      taxAmount: cgstAmount + sgstAmount,
      totalAmount,
      ownerId: req.user.ownerId,
    });

    // ✅ POPULATE RESPONSE
    const populated = await Invoice.findById(invoice._id).populate({
      path: "items.soldId",
      populate: {
        path: "inventoryItem",
        populate: { path: "category" },
      },
    });

    res.json(populated);
  } catch (error) {
    console.error("Bulk invoice error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create invoice",
    });
  }
};

export const getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate({
        path: "items.soldId",
        populate: {
          path: "inventoryItem",
          populate: { path: "category" },
        },
      })
      .populate({
        path: "soldItems",
        populate: {
          path: "inventoryItem",
          populate: { path: "category" },
        },
      });

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch invoice" });
  }
};

export const generateInvoiceFromSold = async (req, res) => {
  const { soldIds } = req.body;

  const soldItems = await Sold.find({
    _id: { $in: soldIds },
    ownerId: req.user.ownerId,
  }).populate("inventoryItem");

  if (!soldItems.length) {
    return res.status(400).json({ message: "No sold items found" });
  }

  const items = soldItems.map((s) => ({
    soldId: s._id,
    serialNumber: s.inventoryItem.serialNumber,
    category: s.inventoryItem.category?.name,
    weight: s.soldWeight,
    pieces: s.soldPieces,
    amount: s.price,
  }));

  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);

  const invoice = await Invoice.create({
    items,
    subtotal,
    totalAmount: subtotal,
    ownerId: req.user.ownerId,
  });

  res.json(invoice);
};

export const generateInvoice = async (req, res) => {
  const { packagingId, keptItemIds } = req.body;

  const packaging = await Packaging.findById(packagingId).populate("items.inventory");

  if (!packaging) {
    return res.status(404).json({ message: "Packaging not found" });
  }

  let invoiceItems = [];
  let subtotal = 0;

  for (const item of packaging.items) {
    const inventoryId = item.inventory._id.toString();

    // ✅ CLIENT KEPT THIS ITEM
    if (keptItemIds.includes(inventoryId)) {
      const amount = item.weight * item.pricePerCarat;
      subtotal += amount;

      invoiceItems.push({
        inventory: inventoryId,
        weight: item.weight,
        pricePerCarat: item.pricePerCarat,
        amount,
      });

      await Inventory.findByIdAndUpdate(inventoryId, {
        status: "sold",
      });
    }
    // ❌ CLIENT RETURNED THIS ITEM
    else {
      await Inventory.findByIdAndUpdate(inventoryId, {
        status: "available",
      });
    }
  }

  const invoice = await Invoice.create({
    packaging: packagingId,
    clientName: packaging.clientName,
    items: invoiceItems,
    subtotal,
    totalAmount: subtotal,
  });

  packaging.status =
    invoiceItems.length === 0
      ? "returned"
      : invoiceItems.length === packaging.items.length
      ? "sold"
      : "partially_sold";

  await packaging.save();

  res.json(invoice);
};


/* =========================
   UPDATE INVOICE
========================= */
export const updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    if (invoice.isLocked) {
      return res.status(400).json({ message: "Invoice is locked and cannot be edited" });
    }

    // Save revision history
    invoice.revisionHistory.push({
      updatedAt: new Date(),
      updatedBy: req.user._id,
      previousSnapshot: { ...invoice.toObject() },
    });

    // Update invoice with new values
    Object.keys(req.body).forEach(key => {
      if (key !== '_id' && key !== '__v' && key !== 'createdAt' && key !== 'updatedAt') {
        invoice[key] = req.body[key];
      }
    });

    await invoice.save();

    res.json(invoice);
  } catch (error) {
    console.error("Update invoice error:", error);
    res.status(500).json({ message: "Failed to update invoice" });
  }
};

/* =========================
   LOCK INVOICE
========================= */
export const lockInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndUpdate(
      req.params.id,
      { 
        isLocked: true,
        lockedAt: new Date(),
        lockedBy: req.user._id
      },
      { new: true }
    );

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    res.json(invoice);
  } catch (error) {
    console.error("Lock invoice error:", error);
    res.status(500).json({ message: "Failed to lock invoice" });
  }
};


/* =========================
   GENERATE BULK INVOICE (TRANSACTION-SAFE)
========================= */
export const generateBulkInvoice = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { soldIds } = req.body;

    if (!soldIds || !Array.isArray(soldIds) || soldIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "soldIds is required and must be a non-empty array",
      });
    }

    // ✅ Remove duplicates while preserving order
    const uniqueSoldIds = [...new Set(soldIds)];

    // ✅ FETCH SOLD ITEMS WITH OWNER VALIDATION
    const soldItems = await Sold.find({
      _id: { $in: uniqueSoldIds },
      ownerId: req.user.ownerId,
    }).session(session);

    if (!soldItems.length) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "No valid sold items found for your account",
      });
    }

    // ✅ VALIDATE ALL ITEMS BELONG TO SAME BUYER (for single invoice)
    const buyers = [...new Set(soldItems.map(s => s.buyer).filter(Boolean))];
    if (buyers.length > 1) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Cannot create bulk invoice for items with different buyers",
      });
    }

    // ✅ CALCULATE SUBTOTAL (use totalPrice to avoid floating-point errors)
    const subtotal = soldItems.reduce((sum, s) => sum + (s.totalPrice || s.price || 0), 0);

    // ✅ FETCH COMPANY INFO
    const company = await Company.findOne({ ownerId: req.user.ownerId }).session(session);
    const taxRate = company?.taxRate || 0;

    // ✅ CALCULATE TAXES (with rounding to prevent floating-point errors)
    const taxAmount = round((subtotal * taxRate) / 100);
    const totalAmount = round(subtotal + taxAmount);

    // ✅ BUILD INVOICE ITEMS
    const invoiceItems = await Promise.all(
      soldItems.map(async (sold) => {
        const inventory = await Inventory.findById(sold.inventoryItem).session(session);

        return {
          soldId: sold._id,
          serialNumber: inventory?.serialNumber || "N/A",
          category: inventory?.category?.name || "N/A",
          soldPieces: sold.soldPieces,
          soldWeight: sold.soldWeight,
          weightUnit: inventory?.weightUnit || "carat",
          price: sold.price,
          currency: sold.currency,
          amount: sold.totalPrice || sold.price,
        };
      })
    );

    // ✅ GENERATE INVOICE NUMBER
    const invoiceNumber = await getNextInvoiceNumber();

    // ✅ CREATE INVOICE
    const invoice = await Invoice.create(
      [
        {
          invoiceNumber,
          buyer: buyers[0] || undefined,
          currency: soldItems[0].currency,

          items: invoiceItems,
          soldItems: uniqueSoldIds, // Store reference to all sold items

          subtotal,
          taxRate,
          taxAmount,
          totalAmount,
          ownerId: req.user.ownerId,
        },
      ],
      { session }
    );

    // ✅ COMMIT TRANSACTION
    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Generate bulk invoice error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to generate bulk invoice",
    });
  }
};
