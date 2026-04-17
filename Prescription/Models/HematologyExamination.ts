import mongoose, { Schema, Document } from "mongoose";

export interface IHematologyExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  cbc: {
    hb: number;
    tlc: number;
    platelets: number;
    esr?: number;
  };

  rbcIndices: {
    mcv?: number;
    mch?: number;
    mchc?: number;
  };

  coagulation: {
    pt?: number;
    inr: number;
    aptt?: number;
  };

  symptoms: (
    | "Fatigue"
    | "Pallor"
    | "Bleeding"
    | "Fever"
    | "Weight loss"
    | "Bone pain"
  )[];

  transfusion: {
    product: string;
    units: number;
    indication: string;
  };

  diagnosis: string;
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

const HematologyExaminationSchema: Schema = new Schema(
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

    cbc: {
      hb: {
        type: Number,
        required: [true, "Hemoglobin is required"],
        min: [0, "Hb cannot be negative"],
        max: [30, "Hb exceeds physiological limits"],
      },
      tlc: {
        type: Number,
        required: [true, "Total Leukocyte Count is required"],
        min: [0, "TLC cannot be negative"],
      },
      platelets: {
        type: Number,
        required: [true, "Platelet count is required"],
        min: [0, "Platelets cannot be negative"],
      },
      esr: { type: Number, min: 0 },
    },

    rbcIndices: {
      mcv: { type: Number, min: 0 },
      mch: { type: Number, min: 0 },
      mchc: { type: Number, min: 0 },
    },

    coagulation: {
      pt: { type: Number, min: 0 },
      inr: {
        type: Number,
        required: [true, "INR is required"],
        min: [0, "INR cannot be negative"],
      },
      aptt: { type: Number, min: 0 },
    },

    symptoms: {
      type: [String],
      enum: [
        "Fatigue",
        "Pallor",
        "Bleeding",
        "Fever",
        "Weight loss",
        "Bone pain",
      ],
    },

    transfusion: {
      product: { type: String, default: "" },
      units: { type: Number, default: 0 },
      indication: { type: String, default: "" },
    },

    diagnosis: { type: String, default: "" },
    notes: { type: String },
  },
  { timestamps: true }
);

// Compound indices
HematologyExaminationSchema.index({ hospital: 1, createdAt: -1 });
HematologyExaminationSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
HematologyExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IHematologyExamination>(
  "HematologyExamination",
  HematologyExaminationSchema
);
