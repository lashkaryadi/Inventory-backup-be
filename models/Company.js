import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    companyName: { type: String, required: true },
    logoUrl: String,

    // Tax & Registration
    gstNumber: String,
    panNumber: String,
    taxRate: { type: Number, default: 0 }, // GST %

    // Contact
    phone: String,
    email: String,
    address: String,
    city: String,
    state: String,
    pincode: String,

    // Bank Details
    bankName: String,
    bankAccountNumber: String,
    bankIfscCode: String,
    bankBranch: String,

    // Documents
    signatureUrl: String,
    termsAndConditions: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Company", companySchema);
