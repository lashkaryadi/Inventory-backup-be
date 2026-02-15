
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import { app } from "./app.js";

const migrateIndexes = async () => {
  try {
    const db = mongoose.connection.db;

    // Drop old unique index on serialNumber (was globally unique, now compound with ownerId)
    const inventoryCollection = db.collection("inventories");
    const indexes = await inventoryCollection.indexes();
    for (const idx of indexes) {
      // Drop any index that is unique on serialNumber alone (not compound with ownerId)
      if (idx.key?.serialNumber && idx.unique && !idx.key?.ownerId) {
        await inventoryCollection.dropIndex(idx.name);
        console.log(`Dropped stale unique index: ${idx.name}`);
      }
    }

    // Drop stale unique index on invoiceNumber in sales collection if it exists
    const salesCollection = db.collection("sales");
    const salesIndexes = await salesCollection.indexes();
    for (const idx of salesIndexes) {
      if (idx.key?.invoiceNumber && idx.unique) {
        await salesCollection.dropIndex(idx.name);
        console.log(`Dropped stale unique index on sales.invoiceNumber: ${idx.name}`);
      }
    }

    // Drop stale unique index on invoiceNumber in invoices collection if it exists
    const invoicesCollection = db.collection("invoices");
    const invoicesIndexes = await invoicesCollection.indexes();
    for (const idx of invoicesIndexes) {
      if (idx.key?.invoiceNumber && idx.unique && !idx.key?.ownerId) {
        await invoicesCollection.dropIndex(idx.name);
        console.log(`Dropped stale unique index on invoices.invoiceNumber: ${idx.name}`);
      }
    }
  } catch (err) {
    // Non-critical - indexes may not exist
    if (err.codeName !== 'IndexNotFound') {
      console.log("Index migration note:", err.message);
    }
  }
};

connectDB().then(async () => {
  await migrateIndexes();

  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
