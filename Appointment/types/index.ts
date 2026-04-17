import { Document, Types } from "mongoose";
import { Request } from "express";

import { IUser } from "../../Auth/types/index.js";
import { IDoctorProfile } from "../../Doctor/types/index.js";
import { IHospital } from "../../Hospital/types/index.js";

export interface IAppointment extends Document {
  patient: Types.ObjectId | IUser;
  globalPatientId?: Types.ObjectId;
  doctor: Types.ObjectId | IDoctorProfile;
  hospital: Types.ObjectId | IHospital;

  createdBy?: Types.ObjectId; // HelpDesk reference

  date: Date;

  appointmentTime?: string; // "10:30 AM"
  startTime?: string;
  endTime?: string;

  status:
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "in-progress"
  | "Booked";

  appointmentId?: string;
  admissionId?: string;

  department?: string;
  visitType?: string;

  symptoms?: string[];
  reason?: string;
  mrn?: string;

  vitals?: {
    bloodPressure?: string;
    temperature?: string;
    pulse?: string;
    spO2?: string;
    height?: string;
    weight?: string;
    glucose?: string;
  };

  patientDetails?: {
    name?: string;
    age?: string;
    gender?: string;
    duration?: string;
  };

  reports?: string[];

  type?:
  | "online"
  | "offline"
  | "OPD"
  | "IPD"
  | "follow-up"
  | "consultation"
  | "emergency"
  | "procedure"
  | "Consultation"
  | "Routine";

  urgency?:
  | "urgent"
  | "non-urgent"
  | "Emergency - Visit Hospital Immediately"
  | "Consult Doctor Soon"
  | "Non-urgent";

  payment?: {
    amount?: number;
    paymentMethod?: string;
    paymentStatus?: "pending" | "paid" | "failed" | "not_required" | "Paid";
    receiptNumber?: string;
  };

  amount?: number; // Legacy support
  paymentStatus?: string; // Legacy support
  stripeSessionId?: string;

  createdAt: Date;
  updatedAt: Date;

  // Consultation tracking
  consultationStartTime?: Date;
  consultationEndTime?: Date;
  consultationDuration?: number; // seconds

  prescription?: Types.ObjectId;
  labToken?: Types.ObjectId;
  pharmacyToken?: Types.ObjectId;

  documentsCollected?: boolean;
  documentsCollectedAt?: Date;
  cloudinaryDocumentUrl?: string;
  cloudinaryLabTokenUrl?: string;

  sentToHelpdesk?: boolean;
  sentToHelpdeskAt?: Date;

  transitStatus?: string;
  isIPD?: boolean;

  // Pause / Resume tracking
  isPaused?: boolean;
  pausedAt?: Date;
  resumedAt?: Date;
  pausedDuration?: number;

  diagnosis?: string;
  clinicalNotes?: string;
  plan?: string;
}

export interface AppointmentRequest extends Request {
  user?: IUser;
}
