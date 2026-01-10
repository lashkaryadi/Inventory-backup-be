import Inventory from "../models/inventoryModel.js";
import Sold from "../models/soldModel.js";

/**
 * GET /api/dashboard
 */
export const getDashboardStats = async (req, res) => {
  try {
    /* ---------------- COUNTS ---------------- */
    const [
      totalInventory,
      in_stockItems,
      soldItems,
      pendingApproval,
    ] = await Promise.all([
      Inventory.countDocuments(),
      Inventory.countDocuments({ status: "in_stock" }),
      Sold.countDocuments(),
      Inventory.countDocuments({ status: "pending" }),
    ]);

    /* ---------------- TOTAL VALUE ---------------- */
    const in_stockInventory = await Inventory.find(
      { status: "in_stock" },
      { price: 1 }
    );

    const totalValue = in_stockInventory.reduce(
      (sum, item) => sum + (item.price || 0),
      0
    );

    /* ---------------- IN-STOCK VALUE CALCULATION ---------------- */
    const inStockInventory = await Inventory.find({ status: "in_stock" });

    let inStockValue = 0;
    let valid = true;

    for (const item of inStockInventory) {
      const saleCodeNum = Number(item.saleCode);

      if (isNaN(saleCodeNum)) {
        valid = false;
        break;
      }

      inStockValue += saleCodeNum * item.weight;
    }

    const calculatedInStockValue = valid ? inStockValue : "-";

    /* ---------------- RECENT SALES ---------------- */
    const recentSales = await Sold.find()
  .sort({ createdAt: -1 })
  .limit(5)
  .populate({
    path: "inventoryItem",
    populate: { path: "category" },
  });

const safeRecentSales = recentSales.filter(
  (s) => s.inventoryItem !== null
);

const mappedRecentSales = safeRecentSales.map((s) => ({
  id: s._id,
  inventoryItem: s.inventoryItem,
  price: s.price,
  currency: s.currency,
  soldDate: s.soldDate,
}));


    res.json({
      data: {
        totalInventory,
        in_stockItems,
        soldItems,
        pendingApproval,
        totalValue,
        inStockValue: calculatedInStockValue,
        recentSales: mappedRecentSales,
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({
      error: "Failed to load dashboard data",
    });
  }
};
