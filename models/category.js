import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// 🔥 COMPOUND INDEX (MULTI-TENANT SAFE)
categorySchema.index({ name: 1, ownerId: 1 }, { unique: true });

categorySchema.set("toJSON", {
  transform: (_, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
  },
});
const Category =
  mongoose.models.Category ||
  mongoose.model("Category", categorySchema);

export default Category;

// export default mongoose.model("Category", categorySchema);
