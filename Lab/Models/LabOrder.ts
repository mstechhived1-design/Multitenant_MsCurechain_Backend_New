import mongoose, { Schema } from "mongoose";
import { ILabOrder } from "../types/index.js";

const labOrderSchema = new Schema<ILabOrder>(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    globalPatientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Who created the request
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    tokenNumber: { type: String },
    prescription: { type: mongoose.Schema.Types.ObjectId, ref: "Prescription" },
    admission: { type: mongoose.Schema.Types.ObjectId, ref: "IPDAdmission" },
    tests: [
      {
        test: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "LabTest",
          required: true,
        },
        testName: String, // Redundant name for display resilience
        status: {
          type: String,
          enum: ["pending", "processing", "completed"],
          default: "pending",
        },
        result: String,
        remarks: String,
        isAbnormal: { type: Boolean, default: false },
        subTests: [
          {
            name: String,
            result: String,
            unit: String,
            range: String,
          },
        ],
      },
    ],
    status: {
      type: String,
      enum: ["prescribed", "sample_collected", "processing", "completed"],
      default: "prescribed",
    },
    totalAmount: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid"],
      default: "pending",
    },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    sampleCollectedAt: Date,
    resultsEnteredAt: Date,
    completedAt: Date,
    doctorNotified: { type: Boolean, default: false }, // NEW: Track if doctor has been notified
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
labOrderSchema.plugin(multiTenancyPlugin);

// Performance indexes for Lab dashboard
labOrderSchema.index({ hospital: 1, status: 1, createdAt: -1 });
labOrderSchema.index({ globalPatientId: 1, hospital: 1 });
labOrderSchema.index({ globalPatientId: 1, createdAt: -1 });
labOrderSchema.index({ hospital: 1, createdAt: -1 });
labOrderSchema.index({ patient: 1, createdAt: -1 });
labOrderSchema.index({ tokenNumber: 1 });
labOrderSchema.index({ createdAt: -1 });
labOrderSchema.index({ paymentStatus: 1, createdAt: -1 });

const LabOrder = mongoose.model<ILabOrder>("LabOrder", labOrderSchema);

// Explicitly drop legacy unique index on LabTest collection if it exists
mongoose.connection.on("open", () => {
  mongoose.connection.db
    ?.collection("labtests")
    .dropIndex("code_1")
    .catch(() => {});
});

export default LabOrder;
