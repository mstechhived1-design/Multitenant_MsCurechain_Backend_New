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
const userSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    mobile: { type: String, required: true, unique: true, sparse: true },
    email: { type: String, lowercase: true, sparse: true, unique: true },
    password: { type: String, required: true },
    role: {
        type: String,
        enum: ["patient", "doctor", "super-admin", "helpdesk", "hospital-admin", "lab", "staff", "pharma-owner", "admin", "nurse", "emergency"],
        required: true,
    },
    hospital: { type: mongoose_1.Schema.Types.ObjectId, ref: "Hospital" },
    doctorId: { type: String, unique: true, sparse: true },
    age: { type: Number },
    ageUnit: { type: String, enum: ["Years", "Months", "Days"], default: "Years" },
    gender: { type: String, enum: ["male", "female", "other"] },
    refreshTokens: [
        {
            tokenHash: String,
            createdAt: { type: Date, default: Date.now },
            expiresAt: Date,
        },
    ],
    resetPasswordToken: { type: String },
    resetPasswordExpire: { type: Date },
    status: { type: String, enum: ["active", "suspended", "inactive"], default: "active" },
    avatar: { type: String },
    dateOfBirth: { type: Date },
    consentGiven: { type: Boolean, default: false },
    consentTimestamp: { type: Date },
    // Pharmacy / Shop Details directly on User for Frontend Access
    shopName: { type: String },
    address: { type: String },
    gstin: { type: String },
    licenseNo: { type: String },
    image: { type: String }, // Used for Logo
    // Staff / Discharge Details
    employeeId: { type: String },
    department: { type: String }
}, { timestamps: true });
// Indexes for faster login/lookup
userSchema.index({ role: 1 });
userSchema.index({ hospital: 1, role: 1, status: 1 });
userSchema.index({ hospital: 1, createdAt: -1 });
userSchema.index({ name: 'text', email: 'text', mobile: 'text' });
const User = mongoose_1.default.model("User", userSchema);
exports.default = User;
