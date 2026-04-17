"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const patientProfileSchema = new mongoose_1.Schema({
    user: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "User", required: true },
    hospital: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "Hospital" },
    mrn: { type: String },
    honorific: { type: String, enum: ["Mr", "Mrs", "Ms", "Dr"] },
    lastVisit: { type: Date },
    medicalHistory: { type: String },
    contactNumber: { type: String },
    emergencyContactEmail: { type: String },
    dob: { type: Date },
    gender: { type: String, enum: ["male", "female", "other"] },
    address: { type: String },
    alternateNumber: { type: String },
    conditions: { type: String, default: "None" },
    allergies: { type: String, default: "None" },
    medications: { type: String, default: "None" },
    height: { type: String },
    weight: { type: String },
    bloodPressure: { type: String },
    temperature: { type: String },
    pulse: { type: String },
    spO2: { type: String },
    glucose: { type: String },
    glucoseType: { type: String },
    sugar: { type: String },
    maritalStatus: { type: String, enum: ["Single", "Married", "Divorced", "Widowed"] },
    bloodGroup: { type: String, enum: ["Unknown", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
    condition: { type: String },
    notes: { type: String }
}, { timestamps: true });
patientProfileSchema.virtual("age").get(function () {
    if (!this.dob)
        return null;
    const ageMs = Date.now() - this.dob.getTime();
    return Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
});
patientProfileSchema.set("toJSON", { virtuals: true });
patientProfileSchema.set("toObject", { virtuals: true });
const PatientProfile = mongoose_1.default.model("PatientProfile", patientProfileSchema);
exports.default = PatientProfile;
