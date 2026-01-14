import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: [
        "SELL_ITEM",
        "UNDO_SOLD",
        "UPDATE_SOLD",
        "CREATE_SALE"
      ],
      required: true,
    },

    entityType: {
      type: String,
      enum: ["inventory", "sold"],
      required: true,
    },

    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    meta: {
      type: Object, // before/after snapshot
      default: {},
    },

    ipAddress: String,
    userAgent: String,

    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("AuditLog", auditLogSchema);
