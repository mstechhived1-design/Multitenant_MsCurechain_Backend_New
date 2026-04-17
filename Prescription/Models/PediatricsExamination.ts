import mongoose, { Schema, Document } from "mongoose";

export interface IPediatricsExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;

  // A. Basic Child Profile
  weight: number;           // kg  — REQUIRED
  height?: number;          // cm
  headCircumference?: number; // cm — only for < 5 yrs

  // B. Vitals
  temperature?: number;    // °F
  heartRate?: number;      // bpm
  respRate?: number;       // breaths/min

  // C. Growth Assessment
  growth: {
    weightForAge?: "Normal" | "Underweight" | "Overweight";
    heightForAge?: "Normal" | "Stunted";
  };

  // D. Developmental Milestones
  milestones?: "Normal" | "Delayed" | "Borderline";
  milestoneNotes?: string;

  // E. Immunization
  immunizationStatus?: "Up to date" | "Partially immunized" | "Not immunized";
  dueVaccines?: string[];

  // F. Symptoms
  symptoms?: (
    | "Fever"
    | "Cough"
    | "Vomiting"
    | "Diarrhea"
    | "Poor Feeding"
    | "Lethargy"
    | "Seizures"
  )[];

  // G. Red Flag Signs
  redFlags?: (
    | "Persistent Fever"
    | "Poor Feeding"
    | "Respiratory Distress"
    | "Convulsions"
  )[];

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PediatricsExaminationSchema: Schema = new Schema(
  {
    prescriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Prescription",
      required: true,
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
    },
    hospital: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    // A. Child Profile
    weight: {
      type: Number,
      required: [true, "Weight is required for pediatric prescription"],
      min: [1, "Weight must be at least 1 kg"],
      max: [100, "Weight exceeds pediatric range (max 100 kg)"],
    },
    height: {
      type: Number,
      min: [30, "Height too low"],
      max: [220, "Height exceeds range"],
    },
    headCircumference: {
      type: Number,
      min: [20, "Head circumference too low"],
      max: [60, "Head circumference too high"],
    },

    // B. Vitals
    temperature: {
      type: Number,
      min: [95, "Temperature below safe range (95°F)"],
      max: [108, "Temperature above safe upper limit (108°F)"],
    },
    heartRate: {
      type: Number,
      min: [40, "Heart rate too low"],
      max: [220, "Heart rate exceeds safe limit"],
    },
    respRate: {
      type: Number,
      min: [10, "Respiratory rate too low"],
      max: [80, "Respiratory rate exceeds safe limit"],
    },

    // C. Growth Assessment
    growth: {
      weightForAge: {
        type: String,
        enum: ["Normal", "Underweight", "Overweight"],
      },
      heightForAge: {
        type: String,
        enum: ["Normal", "Stunted"],
      },
    },

    // D. Developmental Milestones
    milestones: {
      type: String,
      enum: ["Normal", "Delayed", "Borderline"],
    },
    milestoneNotes: { type: String },

    // E. Immunization
    immunizationStatus: {
      type: String,
      enum: ["Up to date", "Partially immunized", "Not immunized"],
    },
    dueVaccines: {
      type: [String],
      enum: [
        "BCG", "OPV", "DPT", "Hib", "PCV", "Rotavirus",
        "IPV", "Hepatitis B", "MMR", "Varicella",
        "Typhoid", "Hepatitis A", "Meningococcal",
      ],
    },

    // F. Symptoms
    symptoms: {
      type: [String],
      enum: [
        "Fever", "Cough", "Vomiting", "Diarrhea",
        "Poor Feeding", "Lethargy", "Seizures",
      ],
    },

    // G. Red Flags
    redFlags: {
      type: [String],
      enum: [
        "Persistent Fever", "Poor Feeding",
        "Respiratory Distress", "Convulsions",
      ],
    },

    notes: { type: String },
  },
  { timestamps: true },
);

PediatricsExaminationSchema.index({ hospital: 1, createdAt: -1 });
PediatricsExaminationSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
PediatricsExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IPediatricsExamination>(
  "PediatricsExamination",
  PediatricsExaminationSchema,
);
