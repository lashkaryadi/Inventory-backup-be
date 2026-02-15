import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.js";
import process from "process";
import dashboardRoutes from "./routes/dashboard.js";
import categoryRoutes from "./routes/categories.js";
import inventoryRoutes from "./routes/inventory.js";
// import soldRoutes from "./routes/sold.js";
import salesRoutes from "./routes/sales.js";
import shapeRoutes from "./routes/shapes.js";
import invoice from "./routes/invoiceRoutes.js";
import userRoutes from "./routes/user.js";
import auditLogRoutes from "./routes/auditLogs.js";
import uploadRoutes from "./routes/upload.js";
import companyUploadRoutes from "./routes/uploadRoutes.js";
import inventoryUploadRoutes from "./routes/inventoryUploadRoutes.js";
import companyRoutes from "./routes/companyRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import recycleBinRoutes from "./routes/recycleBinRoutes.js"; // ✅ NEW
import path from "path";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

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
app.use(cookieParser()); // ✅ REQUIRED
app.use(express.urlencoded({ extended: true }));

/**
 * ✅ Routes
 */
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/inventory", inventoryRoutes);
// app.use("/api/sold", soldRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/shapes", shapeRoutes);
app.use("/api/users", userRoutes);
app.use("/api/invoices", invoice);
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/company", companyRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/recycle-bin", recycleBinRoutes); // ✅ NEW

// 👇 STATIC FILES
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// 👇 ROUTES
app.use("/api/upload", uploadRoutes);
app.use("/api/upload-company", companyUploadRoutes);
app.use("/api/inventory-upload", inventoryUploadRoutes);

/**
 * ✅ Error handling
 */
app.use(notFound);
app.use(errorHandler);

export { app };