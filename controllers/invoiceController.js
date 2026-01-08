import Inventory from "../models/inventoryModel.js";
import Packaging from "../models/Packaging.js";
import Invoice from "../models/Invoice.js";


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
