import mongoose from 'mongoose';

// ==================== SHAPE SCHEMA ====================
const shapeSchema = new mongoose.Schema({
  shape: {
    type: String,
    required: true,
    trim: true
  },
  pieces: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  weight: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  }
}, { _id: false });

// ==================== INVENTORY SCHEMA ====================
const inventorySchema = new mongoose.Schema({
  // SERIAL NUMBER - Auto-generated, immutable
  serialNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },

  // CATEGORY - Optional
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category",
    required: false,
    index: true
  },

  // ==================== SHAPE CONFIGURATION ====================
  shapeType: {
    type: String,
    enum: ["single", "mix"],
    required: true,
    default: "single"
  },

  // For single shape items
  singleShape: {
    type: String,
    trim: true,
    default: null
  },

  // For mix shape items - array of shapes
  shapes: [shapeSchema],

  // ==================== AUTO-CALCULATED TOTALS ====================
  // These are calculated from shapes or set directly for single items
  totalPieces: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },

  totalWeight: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },

  // Available quantities (after sales)
  availablePieces: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },

  availableWeight: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },

  // ==================== CODES & PRICING ====================
  // Codes can be numeric (price/carat) or string (confidential)
  purchaseCode: {
    type: String,
    trim: true,
    default: ""
  },

  saleCode: {
    type: String,
    trim: true,
    default: ""
  },

  // AUTO-CALCULATED based on saleCode logic
  totalPrice: {
    type: Number,
    default: 0,
    min: 0
  },

  // ==================== PHYSICAL ATTRIBUTES ====================
  dimensions: {
    length: {
      type: Number,
      min: 0,
      default: 0
    },
    width: {
      type: Number,
      min: 0,
      default: 0
    },
    height: {
      type: Number,
      min: 0,
      default: 0
    },
    unit: {
      type: String,
      enum: ['mm', 'cm'],
      default: 'mm'
    }
  },

  certification: {
    type: String,
    trim: true,
    default: ""
  },

  location: {
    type: String,
    trim: true,
    default: ""
  },

  // ==================== STATUS & METADATA ====================
  status: {
    type: String,
    enum: ["in_stock", "pending", "partially_sold", "sold"],
    default: "in_stock",
    index: true
  },

  description: {
    type: String,
    trim: true,
    default: ""
  },

  images: [{
    type: String
  }],

  // ==================== MULTI-TENANCY ====================
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },

  // ==================== SOFT DELETE ====================
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },

  deletedAt: {
    type: Date,
    default: null
  },

  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }
}, {
  timestamps: true
});

// ==================== INDEXES ====================
inventorySchema.index({ ownerId: 1, isDeleted: 1, status: 1 });
inventorySchema.index({ serialNumber: 1, ownerId: 1 }, { unique: true });
inventorySchema.index({ category: 1, ownerId: 1 });
inventorySchema.index({ shapeType: 1, singleShape: 1 });
inventorySchema.index({ "shapes.shape": 1 });
inventorySchema.index({ createdAt: -1 });

// ==================== PRE-SAVE MIDDLEWARE ====================
inventorySchema.pre('save', function(next) {
  // Calculate totals based on shape type
  if (this.shapeType === 'single') {
    // For single shape, shapes array should be empty
    this.shapes = [];

    // totalPieces and totalWeight are set directly
    // (already set by controller)

  } else if (this.shapeType === 'mix') {
    // For mix, calculate from shapes array
    this.singleShape = null;

    this.totalPieces = this.shapes.reduce((sum, shape) => sum + (shape.pieces || 0), 0);
    this.totalWeight = this.shapes.reduce((sum, shape) => sum + (shape.weight || 0), 0);
  }

  // Initialize available quantities if new document
  if (this.isNew) {
    this.availablePieces = this.totalPieces;
    this.availableWeight = this.totalWeight;
  }

  // ==================== AUTO-CALCULATE TOTAL PRICE ====================
  // If saleCode is numeric, treat as price per carat
  // If non-numeric, set totalPrice to 0 (confidential)
  if (this.saleCode) {
    const codeAsNumber = parseFloat(this.saleCode);
    if (!isNaN(codeAsNumber) && isFinite(codeAsNumber)) {
      // Numeric: price per carat
      this.totalPrice = this.availableWeight * codeAsNumber;
    } else {
      // Non-numeric: confidential, hide value
      this.totalPrice = 0;
    }
  } else {
    this.totalPrice = 0;
  }

  next();
});

// ==================== INSTANCE METHODS ====================

// Reduce quantity after sale
inventorySchema.methods.reduceQuantity = function(shapeName, pieces, weight) {
  if (this.shapeType === 'single') {
    // For single shape
    this.availablePieces -= pieces;
    this.availableWeight -= weight;
  } else if (this.shapeType === 'mix') {
    // For mix shapes
    const shape = this.shapes.find(s => s.shape === shapeName);
    if (!shape) {
      throw new Error(`Shape "${shapeName}" not found in inventory`);
    }

    shape.pieces -= pieces;
    shape.weight -= weight;

    // Recalculate totals
    this.availablePieces = this.shapes.reduce((sum, s) => sum + s.pieces, 0);
    this.availableWeight = this.shapes.reduce((sum, s) => sum + s.weight, 0);
  }

  // Update status
  if (this.availablePieces === 0 && this.availableWeight === 0) {
    this.status = "sold";
  } else if (this.availablePieces < this.totalPieces || this.availableWeight < this.totalWeight) {
    this.status = "partially_sold";
  }
};

// Restore quantity (undo sale)
inventorySchema.methods.restoreQuantity = function(shapeName, pieces, weight) {
  if (this.shapeType === 'single') {
    this.availablePieces += pieces;
    this.availableWeight += weight;
  } else if (this.shapeType === 'mix') {
    const shape = this.shapes.find(s => s.shape === shapeName);
    if (!shape) {
      throw new Error(`Shape "${shapeName}" not found in inventory`);
    }

    shape.pieces += pieces;
    shape.weight += weight;

    // Recalculate totals
    this.availablePieces = this.shapes.reduce((sum, s) => sum + s.pieces, 0);
    this.availableWeight = this.shapes.reduce((sum, s) => sum + s.weight, 0);
  }

  // Update status
  if (this.availablePieces === this.totalPieces && this.availableWeight === this.totalWeight) {
    this.status = "in_stock";
  } else {
    this.status = "partially_sold";
  }
};

// ==================== STATIC METHODS ====================

// Get all unique shapes for a user
inventorySchema.statics.getAllUniqueShapes = async function(ownerId) {
  // Get single shapes
  const singleShapes = await this.distinct('singleShape', {
    ownerId,
    shapeType: 'single',
    isDeleted: false,
    singleShape: { $ne: '' }
  });

  // Get mix shapes
  const mixShapes = await this.aggregate([
    {
      $match: {
        ownerId: new mongoose.Types.ObjectId(ownerId),
        shapeType: 'mix',
        isDeleted: false
      }
    },
    { $unwind: '$shapes' },
    { $group: { _id: '$shapes.shape' } }
  ]);

  // Combine and deduplicate
  const allShapes = [...new Set([
    ...singleShapes.filter(s => s),
    ...mixShapes.map(s => s._id).filter(s => s)
  ])];

  return allShapes.sort();
};

// Generate next serial number
inventorySchema.statics.generateSerialNumber = async function(categoryId, ownerId) {
  if (!categoryId) {
    // No category - use generic prefix
    // Include deleted items so serial numbers are never reused
    const regex = /^GEN\d{3}$/;
    const lastItem = await this.findOne({
      ownerId,
      serialNumber: regex
    }).sort({ serialNumber: -1 });

    let nextNumber = 1;
    if (lastItem) {
      const currentNumber = parseInt(lastItem.serialNumber.replace('GEN', ''));
      nextNumber = currentNumber + 1;
    }
    return `GEN${String(nextNumber).padStart(3, '0')}`;
  }

  // Lazy-load Category to avoid circular import issues
  const Category = mongoose.model('Category');
  const category = await Category.findById(categoryId);

  if (!category) {
    throw new Error('Category not found');
  }

  // Generate prefix from category name (first 2-3 letters, uppercase)
  const prefix = category.name
    .replace(/[^a-zA-Z]/g, '')
    .substring(0, 3)
    .toUpperCase();

  // Find highest number for this prefix (include deleted items so numbers are never reused)
  const regex = new RegExp(`^${prefix}\\d{3}$`);
  const lastItem = await this.findOne({
    ownerId,
    serialNumber: regex
  }).sort({ serialNumber: -1 });

  let nextNumber = 1;
  if (lastItem) {
    const currentNumber = parseInt(lastItem.serialNumber.replace(prefix, ''));
    nextNumber = currentNumber + 1;
  }

  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
};


export default mongoose.model('Inventory', inventorySchema);