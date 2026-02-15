import Inventory from "../models/Inventory.js";
import Sale from "../models/Sale.js";

export const getDashboardStats = async (req, res) => {
  try {
    const ownerId = req.user.ownerId;

    // COUNT INVENTORY BY STATUS
    const [totalInventory, inStockCount, soldCount, pendingCount, partiallySoldCount] =
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
        Inventory.countDocuments({
          ownerId,
          status: "partially_sold",
          isDeleted: false,
        }),
      ]);

    // TOTAL WEIGHT & PIECES (available in stock)
    const stockAggregation = await Inventory.aggregate([
      {
        $match: {
          ownerId: ownerId,
          status: { $in: ["in_stock", "pending", "partially_sold"] },
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: null,
          totalWeight: { $sum: "$availableWeight" },
          totalPieces: { $sum: "$availablePieces" },
        },
      },
    ]);

    const totalWeight = stockAggregation[0]?.totalWeight || 0;
    const totalPieces = stockAggregation[0]?.totalPieces || 0;

    // INVENTORY VALUE (purchaseCode * availableWeight for non-sold items)
    const inventoryItems = await Inventory.find({
      ownerId,
      status: { $in: ["in_stock", "pending", "partially_sold"] },
      isDeleted: false,
    }).select("purchaseCode saleCode availableWeight");

    const totalValue = inventoryItems.reduce((sum, item) => {
      const purchaseCode = parseFloat(item.purchaseCode) || 0;
      const availableWeight = item.availableWeight || 0;
      return sum + purchaseCode * availableWeight;
    }, 0);

    const inStockValue = inventoryItems.reduce((sum, item) => {
      const purchaseCode = parseFloat(item.purchaseCode) || 0;
      const availableWeight = item.availableWeight || 0;
      return sum + purchaseCode * availableWeight;
    }, 0);

    // TOTAL SALES AMOUNT
    const salesAggregation = await Sale.aggregate([
      {
        $match: {
          ownerId: ownerId,
          cancelled: false,
        },
      },
      {
        $group: {
          _id: null,
          totalSalesAmount: { $sum: "$totalAmount" },
          totalSalesCount: { $sum: 1 },
        },
      },
    ]);

    const totalSalesAmount = salesAggregation[0]?.totalSalesAmount || 0;

    // RECENT SALES (last 5)
    const recentSales = await Sale.find({
      ownerId,
      cancelled: false,
    })
      .populate({
        path: "inventoryId",
        select: "serialNumber category shapeType singleShape shapes availablePieces availableWeight weightUnit",
        populate: { path: "category", select: "name" },
      })
      .sort({ soldAt: -1 })
      .limit(5)
      .lean();

    // Map recent sales to a consistent format
    const mappedSales = recentSales
      .filter((s) => s.inventoryId)
      .map((sale) => ({
        id: sale._id,
        _id: sale._id,
        inventoryItem: {
          _id: sale.inventoryId._id,
          serialNumber: sale.inventoryId.serialNumber,
          category: sale.inventoryId.category,
          shapes: sale.inventoryId.shapes,
          weightUnit: "ct",
        },
        soldShapes: sale.soldShapes,
        totalPieces: sale.totalPieces,
        totalWeight: sale.totalWeight,
        totalAmount: sale.totalAmount,
        customer: sale.customer,
        invoiceNumber: sale.invoiceNumber,
        saleRef: sale.saleRef,
        soldAt: sale.soldAt,
        soldDate: sale.soldAt,
        cancelled: sale.cancelled,
        price: sale.totalAmount,
        currency: "INR",
        buyer: sale.customer?.name || "Walk-in",
        createdAt: sale.createdAt,
      }));

    res.json({
      success: true,
      data: {
        totalInventory,
        in_stockItems: inStockCount,
        soldItems: soldCount,
        pendingApproval: pendingCount,
        partiallySoldItems: partiallySoldCount,
        totalValue: Math.round(totalValue * 100) / 100,
        inStockValue: Math.round(inStockValue * 100) / 100,
        totalWeight: Math.round(totalWeight * 100) / 100,
        totalPieces,
        totalSalesAmount: Math.round(totalSalesAmount * 100) / 100,
        recentSales: mappedSales,
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
