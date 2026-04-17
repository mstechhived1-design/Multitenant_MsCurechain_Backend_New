import mongoose, { Schema, Document } from "mongoose";

export interface INeurologyExamination extends Document {
  prescriptionId: mongoose.Types.ObjectId;
  patientId:      mongoose.Types.ObjectId;
  doctorId:       mongoose.Types.ObjectId;
  hospital:     mongoose.Types.ObjectId;

  // A. GCS — structured (CRITICAL)
  gcs: {
    eye:    number;   // 1–4
    verbal: number;   // 1–5
    motor:  number;   // 1–6
    total:  number;   // auto-calculated
  };

  // B. Mental Status
  mentalStatus: "Alert" | "Drowsy" | "Stupor" | "Coma";

  // C. Motor Power — per limb (0–5)
  motorPower: {
    ru: number;  // Right Upper
    lu: number;  // Left Upper
    rl: number;  // Right Lower
    ll: number;  // Left Lower
  };

  // D. Reflexes
  reflexes: "Normal (2+)" | "Hyperreflexia (3+)" | "Hyporeflexia (1+)" | "Absent (0)";

  // E. Cranial Nerves
  cranialNerves: "Normal" | "Abnormal";
  cranialNerveDeficits?: (
    | "Facial weakness"
    | "Diplopia"
    | "Vision loss"
    | "Hearing loss"
  )[];

  // F. Sensory System
  sensory: "Normal" | "Reduced" | "Absent";

  // G. Coordination
  coordination: "Normal" | "Ataxia" | "Positive Romberg";

  // H. Symptoms
  symptoms: (
    | "Headache"
    | "Seizures"
    | "Weakness"
    | "Numbness"
    | "Loss of consciousness"
    | "Speech difficulty"
    | "Vomiting"
  )[];

  // I. Onset
  onset: "Sudden" | "Gradual" | "Chronic";

  // J. Notes
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

const NeurologyExaminationSchema: Schema = new Schema(
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

    // A. GCS — structured
    gcs: {
      eye: {
        type: Number,
        required: [true, "GCS Eye response is required"],
        min: [1, "GCS Eye must be at least 1"],
        max: [4, "GCS Eye cannot exceed 4"],
      },
      verbal: {
        type: Number,
        required: [true, "GCS Verbal response is required"],
        min: [1, "GCS Verbal must be at least 1"],
        max: [5, "GCS Verbal cannot exceed 5"],
      },
      motor: {
        type: Number,
        required: [true, "GCS Motor response is required"],
        min: [1, "GCS Motor must be at least 1"],
        max: [6, "GCS Motor cannot exceed 6"],
      },
      total: {
        type: Number,
        min: [3, "GCS Total cannot be less than 3"],
        max: [15, "GCS Total cannot exceed 15"],
      },
    },

    // B. Mental Status
    mentalStatus: {
      type: String,
      enum: ["Alert", "Drowsy", "Stupor", "Coma"],
      required: [true, "Mental status is required"],
    },

    // C. Motor Power — per limb
    motorPower: {
      ru: {
        type: Number,
        required: [true, "Right Upper limb motor power is required"],
        min: [0, "Motor power cannot be below 0"],
        max: [5, "Motor power cannot exceed 5"],
      },
      lu: {
        type: Number,
        required: [true, "Left Upper limb motor power is required"],
        min: [0, "Motor power cannot be below 0"],
        max: [5, "Motor power cannot exceed 5"],
      },
      rl: {
        type: Number,
        required: [true, "Right Lower limb motor power is required"],
        min: [0, "Motor power cannot be below 0"],
        max: [5, "Motor power cannot exceed 5"],
      },
      ll: {
        type: Number,
        required: [true, "Left Lower limb motor power is required"],
        min: [0, "Motor power cannot be below 0"],
        max: [5, "Motor power cannot exceed 5"],
      },
    },

    // D. Reflexes
    reflexes: {
      type: String,
      enum: [
        "Normal (2+)",
        "Hyperreflexia (3+)",
        "Hyporeflexia (1+)",
        "Absent (0)",
      ],
      required: [true, "Reflex status is required"],
    },

    // E. Cranial Nerves
    cranialNerves: {
      type: String,
      enum: ["Normal", "Abnormal"],
      required: [true, "Cranial nerve status is required"],
    },
    cranialNerveDeficits: {
      type: [String],
      enum: ["Facial weakness", "Diplopia", "Vision loss", "Hearing loss"],
      validate: {
        validator: function (this: any, v: string[]) {
          if (this.cranialNerves === "Abnormal") {
            return v && v.length > 0;
          }
          return true;
        },
        message: "At least one cranial nerve deficit must be selected when cranial nerves are abnormal",
      },
    },

    // F. Sensory System
    sensory: {
      type: String,
      enum: ["Normal", "Reduced", "Absent"],
      required: [true, "Sensory status is required"],
    },

    // G. Coordination
    coordination: {
      type: String,
      enum: ["Normal", "Ataxia", "Positive Romberg"],
      required: [true, "Coordination status is required"],
    },

    // H. Symptoms
    symptoms: {
      type: [String],
      enum: [
        "Headache",
        "Seizures",
        "Weakness",
        "Numbness",
        "Loss of consciousness",
        "Speech difficulty",
        "Vomiting",
      ],
      validate: {
        validator: function (v: string[]) {
          return v && v.length > 0;
        },
        message: "At least one symptom must be recorded",
      },
    },

    // I. Onset
    onset: {
      type: String,
      enum: ["Sudden", "Gradual", "Chronic"],
      required: [true, "Onset is required"],
    },

    notes: { type: String },
  },
  { timestamps: true },
);

// Indexes
NeurologyExaminationSchema.index({ hospital: 1, createdAt: -1 });
NeurologyExaminationSchema.index({ patientId: 1, createdAt: -1 });

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
NeurologyExaminationSchema.plugin(multiTenancyPlugin);

export default mongoose.model<INeurologyExamination>(
  "NeurologyExamination",
  NeurologyExaminationSchema,
);
