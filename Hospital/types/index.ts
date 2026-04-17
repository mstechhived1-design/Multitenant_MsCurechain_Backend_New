import { Document, Types } from "mongoose";
import { IUser } from "../../Auth/types/index.js";

export interface IBranch {
  name?: string;
  address?: string;
  phone?: string;
  mobile?: string;
  createdAt?: Date;
}

export interface IEmployeeRef {
  user?: Types.ObjectId;
  role?: string;
}

export interface IHospital extends Document {
  hospitalId?: string;
  name: string;
  address: string;
  street?: string;
  landmark?: string;
  city?: string;
  area?: string;
  state?: string;
  location?: { lat: number; lng: number };
  phone?: string;
  logo?: string;
  registrationNumber?: string;
  email?: string;
  pincode?: string;
  establishedYear?: number;
  specialities?: string[];
  services?: string[];
  ambulanceAvailability?: boolean;
  rating?: number;
  website?: string;
  operatingHours?: string;
  status?: "pending" | "approved" | "suspended";
  branches?: IBranch[];
  employees?: IEmployeeRef[];
  unitTypes?: string[];
  billingCategories?: string[];
  clinicalNoteTypes?: string[];
  clinicalNoteVisibilities?: string[];
  ipdPharmaSettings?: {
    enabledWards: string[];
  };
  createdBy?: Types.ObjectId | IUser;
  createdAt: Date;
  updatedAt: Date;
}
