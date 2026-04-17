import mongoose, { Schema, Document } from "mongoose";

export interface IGynecologyExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  hospital: mongoose.Types.ObjectId;

  // A. Menstrual History
  lmp: Date;                              // REQUIRED
  cycleLength?: number;                   // days
  cycleRegularity?: "Regular" | "Irregular";
  flowDuration?: number;                  // days
  flowType?: "Normal" | "Heavy (Menorrhagia)" | "Scanty";

  // B. Obstetric History (Structured)
  obstetric: {
    gravida?: number;
    para?: number;
    living?: number;
    abortions?: number;
  };

  // C. Pregnancy Status
  pregnant: "Yes" | "No" | "Suspected";
  gestationalAge?: number;               // weeks (required if pregnant=Yes)
  edd?: Date;                            // Expected Date of Delivery

  // D. Symptoms
  symptoms?: (
    | "Abdominal Pain"
    | "Bleeding PV"
    | "White Discharge"
    | "Missed Periods"
    | "Nausea/Vomiting"
    | "Swelling"
    | "Decreased Fetal Movement"
  )[];

  // E. Vitals
  vitals?: {
    bp?: string;          // "120/80"
    pulse?: number;
    weight?: number;      // kg
    temperature?: number; // °F
  };

  // F. Obstetric Examination (if pregnant)
  obstetricExam?: {
    uterineSize?: number;                 // weeks
    fetalPosition?: "Cephalic" | "Breech" | "Transverse";
    fetalHeartRate?: number;              // bpm — critical 110–160
  };

  // G. Gynecology Examination
  gynExam?: {
    cervix?: "Normal" | "Inflamed" | "Erosion";
    discharge?: "None" | "White" | "Foul smelling";
    tenderness?: "Yes" | "No";
  };

  // H. Investigations
  investigations?: (
    | "USG"
    | "Hb%"
    | "Urine"
    | "Thyroid"
    | "OGTT"
  )[];

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const GynecologyExaminationSchema: Schema = new Schema(
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

    // A. Menstrual History
    lmp: {
      type: Date,
      required: [true, "LMP (Last Menstrual Period) is required"],
      validate: {
        validator: function (v: Date) {
          return v <= new Date();
        },
        message: "LMP cannot be a future date",
      },
    },
    cycleLength: {
      type: Number,
      min: [14, "Cycle length must be at least 14 days"],
      max: [60, "Cycle length exceeds clinical range"],
    },
    cycleRegularity: {
      type: String,
      enum: ["Regular", "Irregular"],
    },
    flowDuration: {
      type: Number,
      min: [1, "Flow duration must be at least 1 day"],
      max: [15, "Flow duration exceeds clinical range"],
    },
    flowType: {
      type: String,
      enum: ["Normal", "Heavy (Menorrhagia)", "Scanty"],
    },

    // B. Obstetric History
    obstetric: {
      gravida: { type: Number, min: 0, max: 20 },
      para:    { type: Number, min: 0, max: 20 },
      living:  { type: Number, min: 0, max: 20 },
      abortions:{ type: Number, min: 0, max: 20 },
    },

    // C. Pregnancy Status
    pregnant: {
      type: String,
      enum: ["Yes", "No", "Suspected"],
      required: [true, "Pregnancy status is required"],
    },
    gestationalAge: {
      type: Number,
      min: [1, "Gestational age must be at least 1 week"],
      max: [42, "Gestational age cannot exceed 42 weeks"],
      validate: {
        validator: function (this: any, v: number) {
          // Only validate if pregnant = Yes
          if (this.pregnant === "Yes") return v != null && v > 0;
          return true;
        },
        message: "Gestational age is required when patient is pregnant",
      },
    },
    edd: {
      type: Date,
      validate: {
        validator: function (this: any, v: Date) {
          if (this.pregnant === "Yes") return v != null;
          return true;
        },
        message: "EDD (Expected Date of Delivery) is required when patient is pregnant",
      },
    },

    // D. Symptoms
    symptoms: {
      type: [String],
      enum: [
        "Abdominal Pain",
        "Bleeding PV",
        "White Discharge",
        "Missed Periods",
        "Nausea/Vomiting",
        "Swelling",
        "Decreased Fetal Movement",
      ],
    },

    // E. Vitals
    vitals: {
      bp:          { type: String },      // stored as "120/80"
      pulse:       { type: Number, min: [30, "Pulse too low"], max: [200, "Pulse too high"] },
      weight:      { type: Number, min: [20, "Weight too low"], max: [300, "Weight exceeds range (300kg)"] },
      temperature: { type: Number, min: [90, "Temperature below safe range"], max: [110, "Temperature above safe limit"] },
    },

    // F. Obstetric Examination
    obstetricExam: {
      uterineSize: {
        type: Number,
        min: [4, "Uterine size below viable range"],
        max: [45, "Uterine size exceeds range"],
      },
      fetalPosition: {
        type: String,
        enum: ["Cephalic", "Breech", "Transverse"],
      },
      fetalHeartRate: {
        type: Number,
        min: [60, "FHR critically low — immediate evaluation required"],
        max: [200, "FHR critically high — tachycardia"],
        validate: {
          validator: function (v: number) {
            // Warn if outside normal 110–160 — enforced leniently at model level
            return v >= 60 && v <= 200;
          },
          message: "FHR must be between 60-200 bpm",
        },
      },
    },

    // G. Gynecology Examination
    gynExam: {
      cervix:    { type: String, enum: ["Normal", "Inflamed", "Erosion"] },
      discharge: { type: String, enum: ["None", "White", "Foul smelling"] },
      tenderness:{ type: String, enum: ["Yes", "No"] },
    },

    // H. Investigations
    investigations: {
      type: [String],
      enum: ["USG", "Hb%", "Urine", "Thyroid", "OGTT"],
    },

    notes: { type: String },
  },
  { timestamps: true },
);

GynecologyExaminationSchema.index({ hospital: 1, createdAt: -1 });
GynecologyExaminationSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
GynecologyExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<IGynecologyExamination>(
  "GynecologyExamination",
  GynecologyExaminationSchema,
);
