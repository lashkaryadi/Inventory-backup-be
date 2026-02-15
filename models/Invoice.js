import mongoose from "mongoose";

// ==================== INVOICE ITEM SCHEMA ====================
const invoiceItemSchema = new mongoose.Schema({
  saleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Sale",
  },
  serialNumber: {
    type: String,
    default: "-",
  },
  category: {
    type: String,
    default: "-",
  },
  hsnCode: {
    type: String,
    default: "7103", // HSN code for precious/semi-precious stones
  },
  shapes: [{
    shapeName: String,
    pieces: Number,
    weight: Number,
  }],
  soldPieces: {
    type: Number,
    default: 0,
  },
  soldWeight: {
    type: Number,
    default: 0,
  },
  weightUnit: {
    type: String,
    default: "ct",
  },
  pricePerCarat: {
    type: Number,
    default: 0,
  },
  lineTotal: {
    type: Number,
    required: true,
  },
}, { _id: false });

// ==================== INVOICE SCHEMA ====================
const invoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true,
    trim: true,
  },

  // References to sales included in this invoice
  saleIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Sale",
  }],

  // Customer details (denormalized from sales)
  customerName: {
    type: String,
    trim: true,
    default: "Walk-in Customer",
  },
  customerEmail: {
    type: String,
    trim: true,
  },
  customerPhone: {
    type: String,
    trim: true,
  },
  customerAddress: {
    type: String,
    trim: true,
  },
  customerGstin: {
    type: String,
    trim: true,
  },

  // Line items
  items: [invoiceItemSchema],

  // Financial summary
  subtotal: {
    type: Number,
    required: true,
  },
  taxRate: {
    type: Number,
    default: 0,
  },
  cgstRate: {
    type: Number,
    default: 0,
  },
  sgstRate: {
    type: Number,
    default: 0,
  },
  cgstAmount: {
    type: Number,
    default: 0,
  },
  sgstAmount: {
    type: Number,
    default: 0,
  },
  taxAmount: {
    type: Number,
    default: 0,
  },
  discount: {
    type: Number,
    default: 0,
  },
  total: {
    type: Number,
    required: true,
  },

  currency: {
    type: String,
    default: "INR",
  },

  // Invoice metadata
  status: {
    type: String,
    enum: ["draft", "sent", "paid", "overdue", "cancelled"],
    default: "draft",
  },
  issueDate: {
    type: Date,
    default: Date.now,
  },
  dueDate: {
    type: Date,
  },
  paymentTerms: {
    type: String,
    default: "Due on Receipt",
  },
  notes: {
    type: String,
    trim: true,
  },
  placeOfSupply: {
    type: String,
    trim: true,
  },

  // QR code data URL (for GST compliance)
  qrCodeDataUrl: {
    type: String,
  },

  // Multi-tenancy
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  // Lock
  locked: {
    type: Boolean,
    default: false,
  },
  lockedAt: Date,
  lockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
}, {
  timestamps: true,
});

// ==================== INDEXES ====================
invoiceSchema.index({ invoiceNumber: 1, ownerId: 1 }, { unique: true });
invoiceSchema.index({ ownerId: 1, createdAt: -1 });
invoiceSchema.index({ saleIds: 1 });
invoiceSchema.index({ status: 1 });

export default mongoose.model("Invoice", invoiceSchema);
