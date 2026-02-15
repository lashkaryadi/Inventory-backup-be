import AuditLog from "../models/AuditLog.js";
import Inventory from "../models/Inventory.js";
import Sale from "../models/Sale.js";
import Category from "../models/Category.js";
import { generateExcel } from "../utils/excel.js";

export const getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200); // ✅ Increased max
    const skip = (page - 1) * limit;

    const { action, inventoryId } = req.query;

    const query = { ownerId: req.user.ownerId };

    if (action) {
      query.action = action;
    }

    if (inventoryId) {
      query.entityId = inventoryId;
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate("performedBy", "email username")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    // ✅ ENHANCE: Fetch entity names
    const enhancedLogs = await Promise.all(
      logs.map(async (log) => {
        let entityName = "-";

        try {
          if (log.entityType === "inventory" && log.entityId) {
            const inv = await Inventory.findById(log.entityId).select("serialNumber");
            entityName = inv?.serialNumber || "Deleted Item";
          } else if (log.entityType === "sold" && log.entityId) {
            const sale = await Sale.findById(log.entityId)
              .populate("inventoryId", "serialNumber")
              .select("inventoryId saleRef");
            entityName = sale?.inventoryId?.serialNumber || sale?.saleRef || "Deleted Item";
          } else if (log.entityType === "sale" && log.entityId) {
            const sale = await Sale.findById(log.entityId)
              .populate("inventoryId", "serialNumber")
              .select("inventoryId saleRef");
            entityName = sale?.saleRef || sale?.inventoryId?.serialNumber || "Deleted Sale";
          } else if (log.entityType === "category" && log.entityId) {
            const cat = await Category.findById(log.entityId).select("name");
            entityName = cat?.name || "Deleted Category";
          } else if (log.entityType === "recycle_bin") {
            entityName = "Recycle Bin";
          }
        } catch (err) {
          console.error("Error fetching entity name:", err);
        }

        return {
          ...log,
          entityName,
        };
      })
    );

    res.json({
      success: true,
      data: enhancedLogs,
      meta: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Get audit logs error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch audit logs",
    });
  }
};

/* =========================
CLEAR AUDIT LOGS (ADMIN ONLY)
========================= */
export const clearAuditLogs = async (req, res) => {
try {
// ✅ Only allow admin to clear logs
if (req.user.role !== "admin") {
return res.status(403).json({
success: false,
message: "Only admins can clear audit logs",
});
}

const result = await AuditLog.deleteMany({
  ownerId: req.user.ownerId,
});

res.json({
  success: true,
  message: `${result.deletedCount} audit logs cleared`,
});
} catch (err) {
console.error("Clear audit logs error:", err);
res.status(500).json({
success: false,
message: "Failed to clear audit logs",
});
}
};

export const exportAuditLogs = async (req, res) => {
  const logs = await AuditLog.find({ ownerId: req.user.ownerId })
    .populate("performedBy", "username email")
    .sort({ createdAt: -1 });

  const data = logs.map((log) => ({
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId.toString(),
    performedBy: log.performedBy?.email || "-",
    createdAt: log.createdAt,
  }));

  const file = generateExcel(data);

  res.setHeader(
    "Content-Disposition",
    "attachment; filename=audit-logs.xlsx"
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.send(file);
};
