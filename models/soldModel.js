// import db from '../database.js';

// export function getAll() {
//   return db.prepare(`SELECT s.*, i.serialNumber, i.category FROM sold s LEFT JOIN inventory i ON s.inventoryId = i.id`).all();
// }

// export function getById(id) {
//   return db.prepare(`SELECT s.*, i.serialNumber, i.category FROM sold s LEFT JOIN inventory i ON s.inventoryId = i.id WHERE s.id = ?`).get(id);
// }

// export function create(sold) {
//   const stmt = db.prepare(`INSERT INTO sold (inventoryId, serialNumber, soldDate) VALUES (?, ?, ?)`);
//   const info = stmt.run(sold.inventoryId, sold.serialNumber, sold.soldDate);
//   return { id: info.lastInsertRowid, ...sold };
// }


import mongoose from "mongoose";

const soldSchema = new mongoose.Schema(
  {
    // 🔗 Reference to inventory item
    inventoryItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: true,
      //unique: true, // ek inventory item sirf ek baar sold ho
    },

    // 💰 Sale details
    price: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      required: true,
      enum: ["USD", "EUR", "GBP", "INR"],
      default: "USD",
    },

    soldDate: {
      type: Date,
      required: true,
    },

    buyer: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

/* =========================
   INDEXES (IMPORTANT)
========================= */

// Sort by recent sales
soldSchema.index({ createdAt: -1 });

const Sold = mongoose.model("Sold", soldSchema);

export default Sold;
