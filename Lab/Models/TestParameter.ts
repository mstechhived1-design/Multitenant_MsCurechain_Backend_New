import mongoose, { Schema, Document, Types } from "mongoose";

export interface IRange {
  min?: number;
  max?: number;
  text?: string;
}

export interface ITestParameter extends Document {
  testId: Types.ObjectId;
  name: string;
  unit?: string;
  normalRanges: {
    male: IRange;
    female: IRange;
    child: IRange;
    newborn: IRange;
  };
  criticalLow?: string | number;
  criticalHigh?: string | number;
  displayOrder: number;
  isActive: boolean;
  hospital: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const rangeSchema = new Schema(
  {
    min: { type: Number },
    max: { type: Number },
    text: { type: String }, // For display compatibility (e.g. "13-17")
  },
  { _id: false },
);

const testParameterSchema = new Schema<ITestParameter>(
  {
    hospital: { type: Schema.Types.ObjectId, ref: "Hospital", required: false },
    testId: { type: Schema.Types.ObjectId, ref: "LabTest", required: true },
    name: { type: String, required: true },
    unit: { type: String },
    normalRanges: {
      male: { min: Number, max: Number, text: String },
      female: { min: Number, max: Number, text: String },
      child: { min: Number, max: Number, text: String },
      newborn: { min: Number, max: Number, text: String },
      infant: { min: Number, max: Number, text: String }, // Added Infant
      geriatric: { min: Number, max: Number, text: String }, // Added Geriatric
    },
    criticalLow: { type: Schema.Types.Mixed },
    criticalHigh: { type: Schema.Types.Mixed },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

import multiTenancyPlugin from "../../middleware/tenantPlugin.js";
testParameterSchema.plugin(multiTenancyPlugin, {
  includeGlobal: true,
  requireTenant: false,
});

const TestParameter = mongoose.model<ITestParameter>(
  "TestParameter",
  testParameterSchema,
);
export default TestParameter;
