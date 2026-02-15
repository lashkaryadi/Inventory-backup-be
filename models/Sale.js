import mongoose from 'mongoose';

// ==================== SOLD SHAPE SCHEMA ====================
const soldShapeSchema = new mongoose.Schema({
  shape: {
    type: String,
    required: true
  },
  pieces: {
    type: Number,
    required: true,
    min: 0
  },
  weight: {
    type: Number,
    required: true,
    min: 0
  },
  pricePerCarat: {
    type: Number,
    default: 0,
    min: 0
  },
  lineTotal: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: false });

// ==================== SALE SCHEMA ====================
const saleSchema = new mongoose.Schema({
  // Unique sale reference number (auto-generated)
  saleRef: {
    type: String,
    unique: true,
    trim: true,
    index: true
  },

  // Reference to inventory item
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Inventory",
    required: true,
    index: true
  },

  // Shapes that were sold
  soldShapes: [soldShapeSchema],

  // Sale totals
  totalPieces: {
    type: Number,
    required: true,
    min: 0
  },

  totalWeight: {
    type: Number,
    required: true,
    min: 0
  },

  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },

  // Customer information
  customer: {
    name: {
      type: String,
      trim: true,
      default: ""
    },
    email: {
      type: String,
      trim: true,
      default: ""
    },
    phone: {
      type: String,
      trim: true,
      default: ""
    }
  },

  // Invoice details
  invoiceNumber: {
    type: String,
    trim: true,
    index: { unique: true, sparse: true } // Changed to sparse unique index
  },

  soldAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  // Multi-tenancy
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },

  // Cancellation fields
  cancelled: {
    type: Boolean,
    default: false,
    index: true
  },

  cancelledAt: {
    type: Date
  },

  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  cancelReason: {
    type: String,
    trim: true,
    default: ""
  }
}, {
  timestamps: true
});

// ==================== INDEXES ====================
saleSchema.index({ ownerId: 1, cancelled: 1 });
saleSchema.index({ inventoryId: 1 });
// saleSchema.index({ invoiceNumber: 1 }); // Removed redundant index definition, defined in schema path
saleSchema.index({ saleRef: 1, ownerId: 1 });
saleSchema.index({ soldAt: -1 });
saleSchema.index({ createdAt: -1 });

// ==================== AUTO-GENERATE SALE REF ====================
saleSchema.pre('save', async function (next) {
  const Counter = mongoose.model('Counter');
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  // 1. Auto-generate Sale Ref
  if (this.isNew && !this.saleRef) {
    const counter = await Counter.findOneAndUpdate(
      { name: `saleRef-${this.ownerId}-${dateStr}` },
      { $inc: { value: 1 } },
      { new: true, upsert: true }
    );
    this.saleRef = `SALE-${dateStr}-${String(counter.value).padStart(4, '0')}`;
  }

  // 2. Auto-generate Invoice Number if missing
  if (this.isNew && !this.invoiceNumber) {
    const counter = await Counter.findOneAndUpdate(
      { name: `invoice-${this.ownerId}-${dateStr}` }, // Separate counter for invoices
      { $inc: { value: 1 } },
      { new: true, upsert: true }
    );
    this.invoiceNumber = `INV-${dateStr}-${String(counter.value).padStart(4, '0')}`;
  }

  next();
});

// ==================== VIRTUAL FIELDS ====================
saleSchema.virtual('isActive').get(function() {
  return !this.cancelled;
});

export default mongoose.model('Sale', saleSchema);
