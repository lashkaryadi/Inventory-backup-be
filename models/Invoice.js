// import mongoose from "mongoose";

// const invoiceSchema = new mongoose.Schema({
//   packaging: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: "Packaging",
//   },

//   clientName: String,

//   items: [
//     {
//       inventory: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Inventory",
//       },
//       weight: Number,
//       pricePerCarat: Number,
//       amount: Number,
//     },
//   ],

//   subtotal: Number,
//   tax: Number,
//   totalAmount: Number,

//   status: {
//     type: String,
//     enum: ["paid", "unpaid"],
//     default: "unpaid",
//   },

// }, { timestamps: true });

// export default mongoose.model("Invoice", invoiceSchema);

import mongoose from "mongoose";

const invoiceSchema = new mongoose.Schema(
  {
    soldItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sold",
      required: true,
      unique: true, // one invoice per sale
    },

    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
    },

    invoiceDate: {
      type: Date,
      required: true,
      default: Date.now,
    },

    buyer: {
      type: String,
      trim: true,
    },

    currency: {
      type: String,
      enum: ["USD", "EUR", "GBP", "INR"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

const Invoice = mongoose.model("Invoice", invoiceSchema);
export default Invoice;
