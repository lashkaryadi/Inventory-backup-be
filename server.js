import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.js";
import process from "process";
import dashboardRoutes from "./routes/dashboard.js";
import categoryRoutes from "./routes/categories.js";
import inventoryRoutes from "./routes/inventory.js";
import soldRoutes from "./routes/sold.js";
import invoice from "./routes/invoiceRoutes.js";
import userRoutes from "./routes/user.js";
import auditLogRoutes from "./routes/auditLogs.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

dotenv.config();
connectDB();

const app = express();

/**
 * ✅ CORS CONFIG (important)
 */
app.use(
  cors({
    origin: ["http://localhost:8080", "http://localhost:5173"],
    credentials: true,
  })
);

/**
 * ✅ Body parsers
 */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * ✅ Routes
 */
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/sold", soldRoutes);
app.use("/api/users", userRoutes);
app.use("/api/invoices", invoice);
app.use("/api/audit-logs", auditLogRoutes);


/**
 * ✅ Error handling
 */
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
