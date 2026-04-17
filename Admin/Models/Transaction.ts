import mongoose, { Schema, Document, Types } from "mongoose";

export interface ITransaction extends Document {
  user: Types.ObjectId;
  userModel: "User" | "Patient" | "SuperAdmin";
  hospital: Types.ObjectId;
  amount: number;
  type: string;
  status: "pending" | "completed" | "failed";
  referenceId: Types.ObjectId; // E.g., LabOrder ID
  date: Date;
  paymentMode?: "cash" | "upi" | "card" | "mixed" | "other";
  paymentDetails?: {
    cash?: number;
    upi?: number;
    card?: number;
  };
  invoiceNumber?: string;
}

const transactionSchema = new Schema<ITransaction>({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "userModel",
    required: true,
  },
  userModel: {
    type: String,
    required: true,
    enum: ["User", "Patient", "SuperAdmin"],
    default: "User",
  },
  hospital: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hospital",
    required: true,
  },
  amount: { type: Number, required: true },
  type: { type: String, required: true }, // 'lab_test', 'appointment', etc.
  status: {
    type: String,
    enum: ["pending", "completed", "failed"],
    default: "pending",
  },
  referenceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  date: { type: Date, default: Date.now },
  paymentMode: {
    type: String,
    enum: ["cash", "upi", "card", "mixed", "other"],
  },
  paymentDetails: {
    cash: { type: Number, default: 0 },
    upi: { type: Number, default: 0 },
    card: { type: Number, default: 0 },
  },
  invoiceNumber: { type: String },
});

transactionSchema.pre("save", async function (next) {
  if (!this.invoiceNumber && this.hospital) {
    try {
      // Find the most recently created transaction that ACTUALLY HAS an invoiceNumber
      const lastTx = await mongoose
        .model("Transaction")
        .findOne({ hospital: this.hospital, type: this.type, invoiceNumber: { $exists: true, $ne: null } })
        .sort({ date: -1, _id: -1 });

      let nextNum = 1;
      if (lastTx && lastTx.invoiceNumber && lastTx.invoiceNumber.includes("-")) {
        const parts = lastTx.invoiceNumber.split("-");
        nextNum = parseInt(parts[parts.length - 1], 10) + 1;
      } else {
        // Fallback for the very first sequential invoice
        const count = await mongoose.model("Transaction").countDocuments({ hospital: this.hospital, type: this.type });
        nextNum = count + 1;
      }
      
      const prefix = this.type === "lab_test" ? "LAB" : "INV";
      // padStart(4, "0") ensures 0001 to 9999. If nextNum is 10000, it becomes "10000" smoothly.
      this.invoiceNumber = `${prefix}-${nextNum.toString().padStart(4, "0")}`;
    } catch (err) {
      console.error("Error generating invoiceNumber:", err);
      const prefix = this.type === "lab_test" ? "LAB" : "INV";
      this.invoiceNumber = `${prefix}-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
    }
  }
  next();
});

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
transactionSchema.plugin(multiTenancyPlugin);

// Financial reporting indexes
transactionSchema.index({ date: -1 });
transactionSchema.index({ type: 1, status: 1 });
transactionSchema.index({ user: 1, date: -1 });
transactionSchema.index({ referenceId: 1 });
transactionSchema.index({ hospital: 1, date: -1 });

const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  transactionSchema,
);
export default Transaction;
