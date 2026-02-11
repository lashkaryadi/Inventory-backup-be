import RecycleBin from "../models/RecycleBin.js";
import Inventory from "../models/Inventory.js";
import Category from "../models/Category.js";

/* GET LIST */
export const getRecycleBin = async (req, res) => {
  const { page = 1, limit = 10, search, entityType } = req.query;

  const query = { ownerId: req.user.ownerId };

  if (entityType) query.entityType = entityType;
  if (search) {
    query["entityData.name"] = { $regex: search, $options: "i" };
  }

  const items = await RecycleBin.find(query)
    .skip((page - 1) * limit)
    .limit(Number(limit))
    .sort({ deletedAt: -1 });

  const total = await RecycleBin.countDocuments(query);

  res.json({
    data: items,
    meta: {
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    },
  });
};

/* RESTORE */
export const restoreItems = async (req, res) => {
  const { ids } = req.body;

  if (!ids || !ids.length) {
    return res.status(400).json({ success: false, message: "No IDs provided" });
  }

  const items = await RecycleBin.find({ _id: { $in: ids } });

  for (const item of items) {
    if (item.entityType === "inventory") {
      await Inventory.findByIdAndUpdate(
        item.entityId,
        {
          $set: {
            ...item.entityData,
            isDeleted: false,
            deletedAt: null,
          },
        },
        { upsert: true }
      );
    }

    if (item.entityType === "category") {
      await Category.findByIdAndUpdate(
        item.entityId,
        {
          $set: {
            ...item.entityData,
            isDeleted: false,
            deletedAt: null,
          },
        },
        { upsert: true }
      );
    }
  }

  await RecycleBin.deleteMany({ _id: { $in: ids } });

  res.json({ success: true });
};

/* PERMANENT DELETE */
export const deleteItems = async (req, res) => {
  const { ids } = req.body;

  if (!ids || !ids.length) {
    return res.status(400).json({ success: false, message: "No IDs provided" });
  }

  await RecycleBin.deleteMany({ _id: { $in: ids } });

  res.json({ success: true });
};

/* EMPTY BIN */
export const emptyBin = async (req, res) => {
  await RecycleBin.deleteMany({ ownerId: req.user.ownerId });
  res.json({ message: "Recycle bin emptied" });
};
