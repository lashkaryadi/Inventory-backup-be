// import db from '../database.js';

// export function getAll() {
//   return db.prepare('SELECT * FROM inventory').all();
// }

// export function getById(id) {
//   return db.prepare('SELECT * FROM inventory WHERE id = ?').get(id);
// }

// export function create(item) {
//   const stmt = db.prepare(`INSERT INTO inventory
//     (serialNumber, category, pieces, weight, dimensions, certification, location, approvalStatus)
//     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
//   const info = stmt.run(
//     item.serialNumber, item.category, item.pieces, item.weight,
//     item.dimensions, item.certification, item.location, item.approvalStatus
//   );
//   return { id: info.lastInsertRowid, ...item };
// }

// export function update(id, changes) {
//   const stmt = db.prepare(`UPDATE inventory SET
//     serialNumber = ?, category = ?, pieces = ?, weight = ?,
//     dimensions = ?, certification = ?, location = ?, approvalStatus = ?
//     WHERE id = ?`);
//   const info = stmt.run(
//     changes.serialNumber, changes.category, changes.pieces, changes.weight,
//     changes.certification, changes.location, changes.approvalStatus, id
//   );
//   return info.changes;
// }

// export function remove(id) {
//   const stmt = db.prepare('DELETE FROM inventory WHERE id = ?');
//   const info = stmt.run(id);
//   return info.changes;
// }

import mongoose from "mongoose";
import Sold from "./soldModel.js";
import Invoice from "./Invoice.js";
const inventorySchema = new mongoose.Schema(
  {
    serialNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    pieces: {
      type: Number,
      required: true,
      min: 1,
    },

    weight: {
      type: Number,
      required: true,
    },

    weightUnit: {
      type: String,
      enum: ["carat", "gram"],
      required: true,
    },

    /* 🔥 NEW REQUIRED FIELDS */
    purchaseCode: {
      type: String,
      required: true,
      trim: true,
    },

    saleCode: {
      type: String,
      required: true,
      trim: true,
    },

    /* ❌ NOT REQUIRED ANYMORE */

  dimensions: {
  length: {
    type: Number,
  },
  width: {
    type: Number,
  },
  height: {
    type: Number,
  },
  unit: {
    type: String,
    enum: ["mm", "cm", "inch"],
    default: "mm",
  },
},

    location: {
      type: String,
    },

    certification: String,

    status: {
      type: String,
      enum: ["pending", "approved", "sold"],
      default: "pending",
    },

    description: String,
    images: [String],
  },
  { timestamps: true }
);

inventorySchema.set("toJSON", {
  transform: (_, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
  },
});

inventorySchema.pre("deleteOne", { document: true }, async function (next) {
  try {
    const sold = await Sold.findOne({ inventoryItem: this._id });

    if (sold) {
      await Invoice.findOneAndDelete({ soldItem: sold._id });
      await sold.deleteOne();
    }

    next();
  } catch (err) {
    next(err);
  }
});

export default mongoose.model("Inventory", inventorySchema);
