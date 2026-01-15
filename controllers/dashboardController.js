import Inventory from "../models/inventoryModel.js";
import Sold from "../models/soldModel.js";

export const getDashboardStats = async (req, res) => {
try {
const ownerId = req.user.ownerId;

// ✅ COUNT INVENTORY BY STATUS
const [totalInventory, inStockCount, soldCount, pendingCount] =
  await Promise.all([
    Inventory.countDocuments({ ownerId, isDeleted: false }),
    Inventory.countDocuments({
      ownerId,
      status: "in_stock",
      isDeleted: false,
    }),
    Inventory.countDocuments({ ownerId, status: "sold", isDeleted: false }),
    Inventory.countDocuments({
      ownerId,
      status: "pending",
      isDeleted: false,
    }),
  ]);

// ✅ FIX: Calculate inventory value based on purchaseCode * availableWeight (for in-stock items)
// Only for in_stock, pending, and partially_sold items
const inventoryItems = await Inventory.find({
  ownerId,
  status: { $in: ["in_stock", "pending", "partially_sold"] },
  isDeleted: false,
}).select("purchaseCode availableWeight");

const totalValue = inventoryItems.reduce((sum, item) => {
  const purchaseCode = parseFloat(item.purchaseCode) || 0;
  const availableWeight = item.availableWeight || 0;
  return sum + purchaseCode * availableWeight;
}, 0);

const inStockValue = await Inventory.find({
  ownerId,
  status: "in_stock",
  isDeleted: false,
})
  .select("purchaseCode availableWeight")
  .then((items) =>
    items.reduce((sum, item) => {
      const purchaseCode = parseFloat(item.purchaseCode) || 0;
      const availableWeight = item.availableWeight || 0;
      return sum + purchaseCode * availableWeight;
    }, 0)
  );

// ✅ RECENT SALES (last 5)
const recentSales = await Sold.find({
  ownerId,
  isDeleted: { $ne: true },
})
  .populate({
    path: "inventoryItem",
    populate: { path: "category" },
  })
  .sort({ createdAt: -1 })
  .limit(5)
  .lean();

res.json({
  success: true,
  data: {
    totalInventory,
    in_stockItems: inStockCount,
    soldItems: soldCount,
    pendingApproval: pendingCount,
    totalValue: Math.round(totalValue * 100) / 100,
    inStockValue: Math.round(inStockValue * 100) / 100,
    recentSales: recentSales.filter((s) => s.inventoryItem),
  },
});
} catch (err) {
console.error("Dashboard stats error:", err);
res.status(500).json({
success: false,
message: "Failed to fetch dashboard stats",
});
}
};
