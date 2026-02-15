import RecycleBin from "../models/RecycleBin.js";
import Inventory from "../models/Inventory.js";
import Category from "../models/Category.js";
import AuditLog from "../models/AuditLog.js";

/* GET LIST */
export const getRecycleBin = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, entityType } = req.query;

    const query = { ownerId: req.user.ownerId };

    if (entityType) query.entityType = entityType;

    // Search both inventory serialNumber and category name
    if (search && search.trim().length > 0) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { "entityData.name": { $regex: escapedSearch, $options: "i" } },
        { "entityData.serialNumber": { $regex: escapedSearch, $options: "i" } },
        { "entityData.description": { $regex: escapedSearch, $options: "i" } },
      ];
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 10, 100);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      RecycleBin.find(query)
        .skip(skip)
        .limit(limitNum)
        .sort({ deletedAt: -1 })
        .lean(),
      RecycleBin.countDocuments(query),
    ]);

    // Map _id to id for frontend compatibility
    const mappedItems = items.map((item) => ({
      ...item,
      id: item._id.toString(),
    }));

    res.json({
      success: true,
      data: mappedItems,
      meta: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error fetching recycle bin:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch recycle bin items",
      error: error.message,
    });
  }
};

/* RESTORE */
export const restoreItems = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !ids.length) {
      return res.status(400).json({ success: false, message: "No IDs provided" });
    }

    const items = await RecycleBin.find({ _id: { $in: ids } });

    if (items.length === 0) {
      return res.status(404).json({ success: false, message: "No items found to restore" });
    }

    let restoredCount = 0;

    for (const item of items) {
      const entityData = { ...item.entityData };
      // Clean up the data before restoring
      delete entityData._id;
      delete entityData.__v;

      if (item.entityType === "inventory") {
        await Inventory.findByIdAndUpdate(
          item.entityId,
          {
            $set: {
              ...entityData,
              isDeleted: false,
              deletedAt: null,
              deletedBy: null,
            },
          },
          { upsert: true, new: true }
        );
        restoredCount++;
      }

      if (item.entityType === "category") {
        await Category.findByIdAndUpdate(
          item.entityId,
          {
            $set: {
              ...entityData,
              isDeleted: false,
              deletedAt: null,
              deletedBy: null,
            },
          },
          { upsert: true, new: true }
        );
        restoredCount++;
      }
    }

    await RecycleBin.deleteMany({ _id: { $in: ids } });

    // Audit log for restoration
    try {
      for (const item of items) {
        await AuditLog.create({
          action: 'RESTORE_ITEM',
          entityType: item.entityType,
          entityId: item.entityId,
          performedBy: req.user._id || req.user.id,
          meta: {
            entityType: item.entityType,
            serialNumber: item.entityData?.serialNumber || null,
            name: item.entityData?.name || null,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          ownerId: req.user.ownerId,
        });
      }
    } catch (auditErr) {
      console.error('Audit log error:', auditErr);
    }

    res.json({
      success: true,
      message: `${restoredCount} item(s) restored successfully`,
    });
  } catch (error) {
    console.error("Error restoring items:", error);
    res.status(500).json({
      success: false,
      message: "Failed to restore items",
      error: error.message,
    });
  }
};

/* PERMANENT DELETE */
export const deleteItems = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !ids.length) {
      return res.status(400).json({ success: false, message: "No IDs provided" });
    }

    // Fetch items before deleting for audit log
    const items = await RecycleBin.find({ _id: { $in: ids } }).lean();

    const result = await RecycleBin.deleteMany({ _id: { $in: ids } });

    // Audit log for permanent deletion
    try {
      for (const item of items) {
        await AuditLog.create({
          action: 'PERMANENT_DELETE',
          entityType: item.entityType,
          entityId: item.entityId,
          performedBy: req.user._id || req.user.id,
          meta: {
            entityType: item.entityType,
            serialNumber: item.entityData?.serialNumber || null,
            name: item.entityData?.name || null,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          ownerId: req.user.ownerId,
        });
      }
    } catch (auditErr) {
      console.error('Audit log error:', auditErr);
    }

    res.json({
      success: true,
      message: `${result.deletedCount} item(s) permanently deleted`,
    });
  } catch (error) {
    console.error("Error deleting items:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete items",
      error: error.message,
    });
  }
};

/* EMPTY BIN */
export const emptyBin = async (req, res) => {
  try {
    const itemCount = await RecycleBin.countDocuments({ ownerId: req.user.ownerId });
    const result = await RecycleBin.deleteMany({ ownerId: req.user.ownerId });

    // Audit log for emptying recycle bin
    try {
      await AuditLog.create({
        action: 'EMPTY_RECYCLE_BIN',
        entityType: 'recycle_bin',
        performedBy: req.user._id || req.user.id,
        meta: {
          itemsDeleted: result.deletedCount,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        ownerId: req.user.ownerId,
      });
    } catch (auditErr) {
      console.error('Audit log error:', auditErr);
    }

    res.json({
      success: true,
      message: `Recycle bin emptied. ${result.deletedCount} item(s) removed.`,
    });
  } catch (error) {
    console.error("Error emptying recycle bin:", error);
    res.status(500).json({
      success: false,
      message: "Failed to empty recycle bin",
      error: error.message,
    });
  }
};
