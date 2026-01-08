import Inventory from "../models/inventoryModel.js";
import Packaging from "../models/Packaging.js";
import Invoice from "../models/Invoice.js";
import Sold from "../models/soldModel.js";
import { generateInvoicePDF } from "../utils/pdfService.js";

export const downloadInvoicePDF = async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate({
    path: "soldItem",
    populate: {
      path: "inventoryItem",
      populate: { path: "category" },
    },
  });

  if (!invoice) {
    return res.status(404).json({ message: "Invoice not found" });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=${invoice.invoiceNumber}.pdf`
  );

  const doc = generateInvoicePDF(invoice);
  doc.pipe(res);
  doc.end();
};

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
  const soldDoc = await Sold.findById(req.params.soldId).populate({
    path: "inventoryItem",
    populate: { path: "category" },
  });

  if (!soldDoc) {
    return res.status(404).json({ message: "Sold item not found" });
  }

  let invoice = await Invoice.findOne({ soldItem: soldDoc._id });

  // 🔥 auto-create invoice if missing
  if (!invoice) {
    invoice = await Invoice.create({
      soldItem: soldDoc._id,
      invoiceNumber: `INV-${Date.now()}`,
      buyer: soldDoc.buyer,
      currency: soldDoc.currency,
      amount: soldDoc.price,
    });
  }

  const populatedInvoice = await Invoice.findById(invoice._id).populate({
    path: "soldItem",
    populate: {
      path: "inventoryItem",
      populate: { path: "category" },
    },
  });

  res.json(populatedInvoice);
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
