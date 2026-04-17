import { Request, Response } from "express";
import PatientProfile from "../Models/PatientProfile.js";
import Patient from "../Models/Patient.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import { PatientRequest } from "../types/index.js";
import { IUser } from "../../Auth/types/index.js";

export const getProfile = async (req: Request, res: Response) => {
  const profileReq = req as unknown as PatientRequest;
  try {
    // Fetch ALL profiles for this user across all hospitals
    const profiles = await PatientProfile.find({ user: profileReq.user!._id })
      .populate("user", "name email mobile role")
      .populate("hospital", "name address logo");

    if (!profiles || profiles.length === 0)
      return res.status(404).json({ message: "Profile not found" });

    // Return all profiles so frontend can show MRN/details for each hospital
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export const updateProfile = async (req: Request, res: Response) => {
  const updateReq = req as unknown as PatientRequest;
  try {
    const { name, email, ...profileData } = updateReq.body;

    // Update Patient model if name, email, or mobile is provided
    if (name || email || updateReq.body.mobile) {
      const updates: any = {};
      if (name) updates.name = name;
      if (email) updates.email = email;
      if (updateReq.body.mobile) updates.mobile = updateReq.body.mobile;

      await Patient.findByIdAndUpdate(updateReq.user!._id, { $set: updates });
    }

    // Update PatientProfile
    const profile = await PatientProfile.findOneAndUpdate(
      { user: updateReq.user!._id },
      { $set: profileData },
      { new: true, upsert: true },
    ).populate("user", "name email mobile");

    res.json(profile);
  } catch (err: any) {
    if (err.code === 11000) {
      if (err.keyPattern && err.keyPattern.mobile) {
        return res.status(400).json({
          message:
            "This phone number is already registered with another user. Please select another phone number.",
        });
      }
      return res.status(400).json({ message: "Duplicate field value entered" });
    }
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getPatientProfileById = async (req: Request, res: Response) => {
  try {
    // Check if user exists first
    const user = await Patient.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const profile = await PatientProfile.findOne({
      user: req.params.id,
    }).populate("user", "name email mobile role");

    // If profile doesn't exist, return basic user info with empty fields
    if (!profile) {
      return res.json({
        user: user,
        height: "",
        weight: "",
        medications: "",
        address: "",
        gender: "",
        dob: "",
      });
    }

    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Search patients by name, MRN, or mobile
export const searchPatients = async (req: Request, res: Response) => {
  try {
    const { query, hospital } = req.query;

    if (!query || typeof query !== "string") {
      return res.json({ patients: [] });
    }

    // Clean query for mobile search (remove non-digits)
    const mobileQuery = query.replace(/\D/g, "");

    const searchFilter: any = {
      $or: [
        { name: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
        // Add mobile search
        ...(mobileQuery.length > 3
          ? [{ mobile: { $regex: mobileQuery, $options: "i" } }]
          : []),
      ],
    };

    if (hospital) {
      searchFilter.hospitals = hospital;
    } else {
      // Bypass tenant scoping to find patients across all hospitals (Global Search)
      searchFilter.hospitals = { $exists: true };
    }

    const patients = await Patient.find(searchFilter)
      .select("_id name mobile email")
      .limit(10);

    res.json({ patients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get patient details with bed/room information
export const getPatientWithBedInfo = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;

    console.log(
      "[getPatientWithBedInfo] Fetching bed info for patient:",
      patientId,
    );

    // Get user (Patient)
    const user = await Patient.findById(patientId).select("_id name mobile");
    if (!user) {
      console.log("[getPatientWithBedInfo] Patient not found");
      return res.status(404).json({ message: "Patient not found" });
    }

    console.log("[getPatientWithBedInfo] Patient found:", {
      name: (user as any).name,
      id: user._id,
    });

    // Get patient profile to fetch MRN
    const patientProfile = await PatientProfile.findOne({
      user: patientId,
    }).select("mrn");
    const mrnNumber = patientProfile?.mrn || "Not Found";

    console.log("[getPatientWithBedInfo] Patient profile MRN:", mrnNumber);

    // Get active admission
    const admission = await IPDAdmission.findOne({
      patient: patientId,
      status: "Active",
    });

    console.log(
      "[getPatientWithBedInfo] Admission found:",
      admission ? admission._id : "None",
    );

    if (!admission) {
      return res.json({
        patient: user,
        mrnNumber: mrnNumber,
        bedNumber: "Not Found",
        roomNumber: "Not Found",
        message: "No active admission found",
      });
    }

    // Get bed occupancy with populated bed details
    const occupancy = await BedOccupancy.findOne({
      admission: admission._id,
      endDate: null,
    }).populate("bed");

    console.log(
      "[getPatientWithBedInfo] Occupancy found:",
      occupancy ? "Yes" : "No",
    );
    console.log("[getPatientWithBedInfo] Bed details:", occupancy?.bed);

    const bed: any = occupancy?.bed;

    const response = {
      patient: user,
      mrnNumber: mrnNumber,
      bedNumber: bed?.bedId || "Not Found", // Changed from bedNumber to bedId
      roomNumber: bed?.room || "Not Found",
    };

    console.log("[getPatientWithBedInfo] Returning response:", response);

    res.json(response);
  } catch (err) {
    console.error("[getPatientWithBedInfo] Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
