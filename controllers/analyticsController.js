import Sale from "../models/Sale.js";
import Inventory from "../models/Inventory.js";
import mongoose from "mongoose";
import xlsx from "xlsx";

// ==================== GET ANALYTICS DATA ====================
export const getProfitAnalytics = async (req, res) => {
  try {
    const ownerId = new mongoose.Types.ObjectId(req.user.ownerId);

    // TOTAL METRICS
    const totals = await Sale.aggregate([
      { $match: { ownerId, cancelled: false } },
      {
        $group: {
          _id: null,
          revenue: { $sum: "$totalAmount" },
          totalWeight: { $sum: "$totalWeight" },
          totalPieces: { $sum: "$totalPieces" },
          count: { $sum: 1 },
        },
      },
    ]);

    // MONTHLY SALES
    const monthly = await Sale.aggregate([
      { $match: { ownerId, cancelled: false } },
      {
        $group: {
          _id: {
            year: { $year: "$soldAt" },
            month: { $month: "$soldAt" },
          },
          revenue: { $sum: "$totalAmount" },
          count: { $sum: 1 },
          weight: { $sum: "$totalWeight" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Format monthly data
    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    const formattedMonthly = monthly.map((m) => ({
      month: `${monthNames[m._id.month - 1]} ${m._id.year}`,
      revenue: m.revenue,
      count: m.count,
      weight: m.weight,
    }));

    // TOP CATEGORIES BY REVENUE
    const categories = await Sale.aggregate([
      { $match: { ownerId, cancelled: false } },
      {
        $lookup: {
          from: "inventories",
          localField: "inventoryId",
          foreignField: "_id",
          as: "inventory",
        },
      },
      { $unwind: "$inventory" },
      {
        $lookup: {
          from: "categories",
          localField: "inventory.category",
          foreignField: "_id",
          as: "category",
        },
      },
      {
        $group: {
          _id: { $arrayElemAt: ["$category.name", 0] },
          revenue: { $sum: "$totalAmount" },
          count: { $sum: 1 },
          weight: { $sum: "$totalWeight" },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]);

    // TOP CUSTOMERS
    const customers = await Sale.aggregate([
      { $match: { ownerId, cancelled: false } },
      {
        $group: {
          _id: "$customer.name",
          revenue: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]);

    // INVENTORY STATS
    const inventoryStats = await Inventory.aggregate([
      { $match: { ownerId, isDeleted: false } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalWeight: { $sum: "$availableWeight" },
          totalPieces: { $sum: "$availablePieces" },
        },
      },
    ]);

    res.json({
      success: true,
      totals: totals[0] || { revenue: 0, totalWeight: 0, totalPieces: 0, count: 0 },
      monthly: formattedMonthly,
      categories,
      customers,
      inventoryStats,
    });
  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ success: false, message: "Failed to generate analytics" });
  }
};

// ==================== EXPORT ANALYTICS TO EXCEL ====================
export const exportProfitExcel = async (req, res) => {
  try {
    const ownerId = req.user.ownerId;

    const sales = await Sale.find({ ownerId, cancelled: false })
      .populate({
        path: "inventoryId",
        select: "serialNumber category purchaseCode",
        populate: { path: "category", select: "name" },
      })
      .sort({ soldAt: -1 })
      .lean();

    const rows = sales.map((s) => ({
      "Sale Ref": s.saleRef || "-",
      "Date": s.soldAt ? new Date(s.soldAt).toLocaleDateString("en-IN") : "-",
      "Serial Number": s.inventoryId?.serialNumber || "-",
      "Category": s.inventoryId?.category?.name || "-",
      "Customer": s.customer?.name || "Walk-in",
      "Total Pieces": s.totalPieces,
      "Total Weight (ct)": s.totalWeight,
      "Revenue": s.totalAmount,
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 22 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
      { wch: 20 }, { wch: 12 }, { wch: 15 }, { wch: 15 },
    ];
    xlsx.utils.book_append_sheet(wb, ws, "Analytics Report");
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", "attachment; filename=analytics-report.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Export analytics error:", error);
    res.status(500).json({ success: false, message: "Failed to export analytics" });
  }
};
