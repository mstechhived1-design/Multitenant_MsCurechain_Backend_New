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
const ipdAdmissionSchema = new mongoose_1.Schema({
    admissionId: { type: String, required: true, unique: true, index: true },
    patient: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    primaryDoctor: { type: mongoose_1.Schema.Types.ObjectId, ref: "DoctorProfile", required: true },
    admissionDate: { type: Date, default: Date.now },
    admissionType: { type: String, enum: ["ICU", "Ward", "Emergency", "General", "Private", "Semi-Private"], required: true },
    status: { type: String, enum: ["Active", "Discharged", "Discharge Initiated"], default: "Active" },
    diet: { type: String },
    clinicalNotes: { type: String },
    reason: { type: String }, // Primary symptoms/reason for admission
    vitals: {
        height: { type: String },
        weight: { type: String },
        bloodPressure: { type: String },
        temperature: { type: String },
        pulse: { type: String },
        spO2: { type: String },
        respiratoryRate: { type: String },
        glucose: { type: String },
        glucoseType: { type: String },
        status: { type: String, enum: ["Stable", "Warning", "Critical"], default: "Stable" },
        condition: { type: String },
        notes: { type: String },
        lastVitalsRecordedAt: { type: Date },
        nextVitalsDue: { type: Date }
    },
    hospital: { type: mongoose_1.Schema.Types.ObjectId, ref: "Hospital", required: true },
    amount: { type: Number, default: 0 },
    paymentMethod: { type: String, default: "cash" },
    paymentStatus: {
        type: String,
        enum: ["pending", "paid", "failed", "not_required"],
        default: "pending"
    },
    dischargeRequested: { type: Boolean, default: false },
    dischargeRequestedAt: { type: Date },
    dischargeRequestedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
    transferRequested: { type: Boolean, default: false },
    transferRequestedAt: { type: Date },
    transferRequestedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });
const IPDAdmission = mongoose_1.default.model("IPDAdmission", ipdAdmissionSchema);
exports.default = IPDAdmission;
