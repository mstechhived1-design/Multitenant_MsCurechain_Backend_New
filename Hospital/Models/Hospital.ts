import mongoose, { Schema } from "mongoose";
import { IHospital } from "../types/index.js";

const branchSchema = new mongoose.Schema({
  name: String,
  address: String,
  phone: String,
  mobile: String,
  createdAt: { type: Date, default: Date.now },
});

const employeeRefSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  role: String,
});

const hospitalSchema = new Schema<IHospital>(
  {
    hospitalId: { type: String, unique: true, sparse: true },
    name: { type: String, required: true },
    address: { type: String, required: true },
    street: String,
    landmark: String,
    city: String,
    area: String,
    state: String,
    location: { lat: Number, lng: Number },
    phone: String,
    logo: String,
    registrationNumber: String,
    email: String,
    pincode: String,
    establishedYear: Number,
    specialities: [String],
    services: [String],
    ambulanceAvailability: { type: Boolean, default: false },
    rating: Number,
    website: String,
    operatingHours: String,
    status: {
      type: String,
      enum: ["pending", "approved", "suspended"],
      default: "pending",
    },
    branches: [branchSchema],
    employees: [employeeRefSchema],
    unitTypes: {
      type: [String],
      default: [],
    },
    billingCategories: {
      type: [String],
      default: [
        "Consultation",
        "Procedure",
        "Pharmacy",
        "Laboratory",
        "Radiology",
        "Nursing",
        "Equipments",
        "Other",
      ],
    },
    clinicalNoteTypes: {
      type: [String],
      default: [
        "Progress Note",
        "Nursing Assessment",
        "Medication Administration Note",
        "Post-Op Monitoring",
        "Incident",
        "Shift Handover",
      ],
    },
    clinicalNoteVisibilities: {
      type: [String],
      default: ["Nurse", "Doctor", "Admin"],
    },
    ipdPharmaSettings: {
      enabledWards: { type: [String], default: [] },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const Hospital = mongoose.model<IHospital>("Hospital", hospitalSchema);
export default Hospital;
