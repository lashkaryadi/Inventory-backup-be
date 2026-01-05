import Database from 'better-sqlite3';
const db = new Database('gemstone-inventory.db');
import mongoose from "mongoose";
import dotenv from 'dotenv';
dotenv.config();

const connectDB = async () => { 
  console.log("  ENV CHECK:", {
    DB_TYPE: process.env.DB_TYPE,
    MONGO_URI: process.env.MONGO_URI,
  });
  if (process.env.DB_TYPE !== "mongodb") {
    console.log("⚠️ MongoDB skipped (DB_TYPE is not mongodb)");
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected successfully");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

export default connectDB;

// // Inventory Table
// const createInventory = `CREATE TABLE IF NOT EXISTS inventory (
//   id INTEGER PRIMARY KEY AUTOINCREMENT,
//   serialNumber TEXT UNIQUE,
//   category TEXT,
//   weight REAL,
//   certification TEXT,
//   location TEXT,
//   approvalStatus TEXT,
//   createdAt TEXT DEFAULT CURRENT_TIMESTAMP
// )`;
// db.exec(createInventory);

// // Users Table
// const createUsers = `CREATE TABLE IF NOT EXISTS users (
//   id INTEGER PRIMARY KEY AUTOINCREMENT,
//   username TEXT UNIQUE,
//   password TEXT,
//   role TEXT,
//   createdAt TEXT DEFAULT CURRENT_TIMESTAMP
// )`;
// db.exec(createUsers);

// // Sold Items Table
// const createSold = `CREATE TABLE IF NOT EXISTS sold (
//   id INTEGER PRIMARY KEY AUTOINCREMENT,
//   inventoryId INTEGER,
//   serialNumber TEXT,
//   soldDate TEXT,
//   FOREIGN KEY (inventoryId) REFERENCES inventory (id)
// )`;
// db.exec(createSold);

// export default db;
