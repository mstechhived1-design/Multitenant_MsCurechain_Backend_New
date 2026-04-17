import mongoose, { Schema } from "mongoose";
import { IIPDAdvancePayment } from "../types/index.js";

const ipdAdvancePaymentSchema = new Schema<IIPDAdvancePayment>(
  {
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    globalPatientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    admission: {
      type: Schema.Types.ObjectId,
      ref: "IPDAdmission",
      required: true,
    },
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: true },
    amount: { type: Number, required: true },
    mode: {
      type: String,
      enum: ["Cash", "Card", "UPI", "Insurance", "Bank Transfer"],
      required: true,
    },
    reference: { type: String },
    transactionType: {
      type: String,
      enum: ["Advance", "Refund", "Settlement"],
      required: true,
    },
    date: { type: Date, default: Date.now },
    receivedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
ipdAdvancePaymentSchema.plugin(multiTenancyPlugin);

ipdAdvancePaymentSchema.index({ globalPatientId: 1, hospital: 1 });
ipdAdvancePaymentSchema.index({ admission: 1, date: -1 });

const IPDAdvancePayment = mongoose.model<IIPDAdvancePayment>(
  "IPDAdvancePayment",
  ipdAdvancePaymentSchema,
);
export default IPDAdvancePayment;
