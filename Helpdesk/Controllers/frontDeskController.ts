import { Request, Response } from "express";
import mongoose from "mongoose";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import User from "../../Auth/Models/User.js";
import Patient from "../../Patient/Models/Patient.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import BedOccupancy from "../../IPD/Models/BedOccupancy.js";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { HelpdeskRequest } from "../types/index.js";
import redisService from "../../config/redis.js";
import Transaction from "../../Admin/Models/Transaction.js";

const invalidateIPDCache = async (
  hospitalId: string,
  bedIds?: string | string[],
) => {
  const promises = [
    redisService.del(`ipd:admissions:active:${hospitalId}`),
    redisService.del(`nurse:stats:${hospitalId}`),
    redisService.delPattern(`ipd:beds:${hospitalId}*`),
  ];

  if (bedIds) {
    const ids = Array.isArray(bedIds) ? bedIds : [bedIds];
    ids.forEach((id) => {
      promises.push(redisService.del(`ipd:bed:details:${id}`));
    });
  }

  await Promise.all(promises);
};

// Helper to generate User Credentials
const generateCredentials = (
  name: string,
  mobile: string,
  dob?: string | Date,
) => {
  const cleanName = name
    .split(" ")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const last4Mobile = mobile.slice(-4);
  const username = `${cleanName}${last4Mobile}`;

  let password = `Pass${last4Mobile}@`;

  if (dob) {
    const d = new Date(dob);
    if (!isNaN(d.getTime())) {
      const day = d.getUTCDate().toString().padStart(2, "0");
      const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
      const year = d.getUTCFullYear();
      password = `${day}${month}${year}`;
    }
  }

  return { username, password };
};

// Helper to generate IDs
const generateId = (prefix: string) => {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${timestamp}-${random}`;
};

export const registerPatient = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction({
      readConcern: { level: "local" },
      writeConcern: { w: 1 },
    });

    try {
      const {
        name,
        mobile,
        email,
        gender,
        dob,
        address,
        age,
        honorific,
        height,
        weight,
        bloodPressure,
        bp,
        temperature,
        pulse,
        pulseRate,
        spO2,
        spo2,
        sugar,
        maritalStatus,
        bloodGroup,
        conditions,
        allergies,
        medications,
        medicalHistory,
        symptoms,
        reason,
        department,
        doctorId,
        visitType,
        appointmentDate,
        appointmentTime,
        amount,
        paymentMethod,
        paymentStatus,
        emergencyContact,
        emergencyContactEmail,
        receiptNumber,
      } = req.body;

      const vitalsInput = req.body.vitals || {};

      const finalVitals = {
        height: vitalsInput.height || height,
        weight: vitalsInput.weight || weight,
        bloodPressure:
          vitalsInput.bloodPressure || vitalsInput.bp || bp || bloodPressure,
        temperature: vitalsInput.temperature || temperature,
        pulse: vitalsInput.pulse || vitalsInput.pulseRate || pulse || pulseRate,
        spO2: vitalsInput.spO2 || vitalsInput.spo2 || spO2 || spo2,
        sugar: vitalsInput.sugar || sugar,
      };

      let allergiesString = "";
      if (allergies) {
        if (Array.isArray(allergies)) {
          allergiesString = allergies.filter((a) => a).join(", ");
        } else {
          allergiesString = String(allergies);
        }
      }

      const paymentInput = req.body.payment || {
        amount,
        paymentMethod,
        paymentStatus,
      };
      const visitTypeInput = req.body.visitType || req.body.type || "offline";

      let finalDoctorId = doctorId;
      let doctorProfile: any = null;
      if (doctorId) {
        doctorProfile = await (
          DoctorProfile.findById(doctorId) as any
        ).unscoped();
        if (!doctorProfile) {
          doctorProfile = await (
            DoctorProfile.findOne({ user: doctorId }) as any
          ).unscoped();
          if (doctorProfile) {
            finalDoctorId = doctorProfile._id;
          } else {
            throw new ApiError(
              404,
              "Doctor not found. Please provide a valid Doctor Profile ID or User ID.",
            );
          }
        } else {
          finalDoctorId = doctorProfile._id;
        }
      }

      const helpdesk = req.user as any;
      const hospitalId = helpdesk.hospital;

      // Build search criteria: Name + (Mobile or Email)
      // This allows family members to share a phone number while remaining separate patients
      const nameRegex = { $regex: new RegExp(`^${name}$`, "i") };
      const searchCriteria: any = {
        name: nameRegex,
        $or: [{ mobile }],
      };
      if (email) {
        searchCriteria.$or.push({ email: email.toLowerCase() });
      }

      let user: any = await (Patient.findOne(searchCriteria) as any).unscoped();

      // Fallback: If no exact name match, check if there's a patient with the same mobile/email
      // who has a placeholder name (like "Unknown Patient"), in which case we SHOULD reuse and update it.
      if (!user) {
        const placeholderCriteria: any = {
          name: {
            $in: [
              "Unknown Patient",
              "Unnamed Patient",
              "Unknown",
              "Placeholder",
            ],
          },
          $or: [{ mobile }],
        };
        if (email) {
          placeholderCriteria.$or.push({ email: email.toLowerCase() });
        }
        user = await (Patient.findOne(placeholderCriteria) as any).unscoped();
      }
      let patientProfile: any = null;
      if (user) {
        patientProfile = await (
          PatientProfile.findOne({
            user: user._id,
            hospital: hospitalId,
          }) as any
        ).unscoped();
      }

      let isNewUser = false;
      let generatedPassword = "";

      if (!user) {
        isNewUser = true;
        let passwordDob = dob;
        if (!passwordDob && age) {
          const d = new Date();
          d.setFullYear(d.getFullYear() - Number(age));
          passwordDob = d;
        }

        const { password } = generateCredentials(name, mobile, passwordDob);
        generatedPassword = password;
        const hashedPassword = await bcrypt.hash(password, 10);

        user = new Patient({
          name,
          mobile,
          email: email ? email.toLowerCase() : undefined,
          password: hashedPassword,
          role: "patient",
          hospitals: [hospitalId],
          status: "active",
        });
        await user.save({ session });
      } else {
        console.log(
          `[registerPatient] Found existing patient with mobile ${mobile}. Reusing...`,
        );
        if (!user.hospitals) {
          user.hospitals = [];
        }

        // Ensure existing singular hospital is in the array
        const legacyHospital = (user as any).hospital;
        if (legacyHospital) {
          if (
            !user.hospitals.some(
              (h: any) => h.toString() === legacyHospital.toString(),
            )
          ) {
            user.hospitals.push(legacyHospital);
          }
          await Patient.collection.updateOne(
            { _id: user._id },
            { $unset: { hospital: "" } },
          );
        }

        // Ensure the new hospitalId is in the array
        if (
          hospitalId &&
          !user.hospitals.some(
            (h: any) => h.toString() === hospitalId.toString(),
          )
        ) {
          user.hospitals.push(hospitalId);
        }

        // Update email if provided and not already set
        if (email && !user.email) {
          user.email = email.toLowerCase();
        }

        // Update name if user exists but has a placeholder name
        if (
          name &&
          (user.name === "Unknown Patient" ||
            user.name.toLowerCase().includes("unnamed") ||
            user.name.toLowerCase().includes("placeholder"))
        ) {
          user.name = name;
        }

        await user.save({ session });

        // Calculate credentials for existing user as well (based on the provided DOB or existing recorded DOB)
        const creds = generateCredentials(
          name || user.name,
          mobile,
          dob || patientProfile?.dob,
        );
        generatedPassword = creds.password;
      }

      if (!patientProfile) {
        patientProfile = await (
          PatientProfile.findOne({
            user: user._id,
            hospital: hospitalId,
          }) as any
        ).unscoped();
      }

      if (!patientProfile) {
        const mrn = generateId("MRN");
        patientProfile = new PatientProfile({
          user: user._id,
          hospital: hospitalId,
          mrn,
          honorific:
            honorific ||
            (gender === "male"
              ? "Mr"
              : maritalStatus === "Married" && gender === "female"
                ? "Mrs"
                : "Ms"),
          gender,
          dob: dob ? new Date(dob) : undefined,
          address: address ? address.trim() : "N/A",
          contactNumber: mobile,
          alternateNumber:
            typeof emergencyContact === "object" && emergencyContact?.mobile
              ? emergencyContact.mobile
              : typeof emergencyContact === "string"
                ? emergencyContact
                : "N/A",
          emergencyContactEmail,
          height: finalVitals.height,
          weight: finalVitals.weight,
          bloodPressure: finalVitals.bloodPressure,
          temperature: finalVitals.temperature,
          pulse: finalVitals.pulse,
          spO2: finalVitals.spO2,
          sugar: finalVitals.sugar,
          maritalStatus,
          bloodGroup: bloodGroup || "N/A",
          conditions:
            conditions && typeof conditions !== "string"
              ? JSON.stringify(conditions)
              : conditions || medicalHistory || "None",
          medicalHistory:
            medicalHistory && typeof medicalHistory !== "string"
              ? JSON.stringify(medicalHistory)
              : medicalHistory || conditions || "None",
          allergies: allergiesString || "None",
          medications: medications || "None",
        });

        if (!dob && age) {
          const calculatedDob = new Date();
          calculatedDob.setFullYear(calculatedDob.getFullYear() - Number(age));
          patientProfile.dob = calculatedDob;
        }
        await patientProfile.save({ session });
      }

      // 4. Create/Get Appointment (Visit)
      const adDate = appointmentDate ? new Date(appointmentDate) : new Date();
      const finalTime =
        appointmentTime ||
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });

      // Check if this is an IPD appointment and if there's an existing IPD admission
      let finalPaymentAmount = paymentInput.amount || 0;
      let finalPaymentMethod = paymentInput.paymentMethod || "cash";
      let finalPaymentStatus = paymentInput.paymentStatus || "pending";

      if (visitTypeInput.toUpperCase() === "IPD") {
        // Look for existing IPD admission for this patient
        const existingAdmission = await (
          IPDAdmission.findOne({
            patient: user._id,
            hospital: hospitalId,
            status: { $in: ["Active", "Discharge Initiated"] },
          }) as any
        )
          .unscoped()
          .sort({ createdAt: -1 });

        if (existingAdmission) {
          // Use payment details from the IPD admission
          finalPaymentAmount = existingAdmission.amount || 0;
          finalPaymentMethod = existingAdmission.paymentMethod || "cash";
          finalPaymentStatus = existingAdmission.paymentStatus || "pending";
          console.log(
            `[Register Patient] Found IPD admission ${existingAdmission.admissionId}, syncing payment: ₹${finalPaymentAmount}`,
          );
        }
      }

      // 🏥 SOFT CHECK: Info only (hard block removed per request)
      if (finalDoctorId) {
        const [activeAdmission, runningConsultation] = await Promise.all([
          (
            IPDAdmission.findOne({
              patient: user._id,
              hospital: hospitalId,
              status: { $in: ["Active", "Discharge Initiated"] },
            }) as any
          ).unscoped(),
          (
            Appointment.findOne({
              patient: user._id,
              status: "in-progress",
            }) as any
          ).unscoped(),
        ]);

        if (activeAdmission || runningConsultation) {
          console.warn(
            `[REGISTRATION] Patient ${user._id} has active engagement but booking allowed by user request.`,
          );
        }

        // Also check if they already have an active appointment with the SAME doctor today
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const existingActiveBooking = await (
          Appointment.findOne({
            patient: user._id,
            doctor: finalDoctorId,
            date: { $gte: startOfDay, $lte: endOfDay },
            status: { $in: ["pending", "confirmed", "Booked", "waiting"] },
          }) as any
        ).unscoped();

        if (existingActiveBooking) {
          throw new ApiError(
            400,
            "Patient already has an active booking or is in the queue for this doctor today.",
          );
        }
      }

      let appointment: any = null as any;
      if (finalDoctorId) {
        appointment = new Appointment({
          appointmentId: generateId("APT"),
          patient: user._id,
          doctor: finalDoctorId,
          hospital: hospitalId,
          createdBy: helpdesk._id,
          department: department || "General",
          date: adDate,
          appointmentTime: finalTime,
          startTime: finalTime,
          endTime: finalTime,
          status:
            visitTypeInput.toUpperCase() === "IPD" ? "confirmed" : "Booked",
          type:
            visitTypeInput.toUpperCase() === "IPD"
              ? "IPD"
              : visitTypeInput.toLowerCase() === "online"
                ? "online"
                : "offline",
          visitType: visitTypeInput,
          urgency: "non-urgent",
          payment: {
            amount: finalPaymentAmount,
            paymentMethod: finalPaymentMethod,
            paymentStatus: finalPaymentStatus,
            receiptNumber,
          },
          amount: finalPaymentAmount,
          paymentStatus: finalPaymentStatus,
          symptoms: symptoms
            ? Array.isArray(symptoms)
              ? symptoms
              : [symptoms]
            : [],
          reason,
          mrn: patientProfile.mrn,
          vitals: finalVitals,
          patientDetails: {
            age: age || patientProfile.age,
            gender: gender || patientProfile.gender,
            duration: doctorProfile?.consultationDuration
              ? `${doctorProfile.consultationDuration} min`
              : "15 min",
          },
        });

        await appointment.save({ session });

        // ✅ NEW: Record in global Transaction ledger
        if (finalPaymentAmount > 0) {
          await Transaction.create(
            [
              {
                user: user._id,
                hospital: hospitalId,
                amount: finalPaymentAmount,
                type:
                  visitTypeInput.toUpperCase() === "IPD"
                    ? "ipd_advance"
                    : "appointment_booking",
                status: finalPaymentStatus === "Paid" ? "completed" : "pending",
                referenceId: appointment._id,
                date: new Date(),
                paymentMode: finalPaymentMethod.toLowerCase(),
                paymentDetails: {
                  cash:
                    finalPaymentMethod.toLowerCase() === "cash"
                      ? finalPaymentAmount
                      : 0,
                  upi:
                    finalPaymentMethod.toLowerCase() === "upi"
                      ? finalPaymentAmount
                      : 0,
                  card:
                    finalPaymentMethod.toLowerCase() === "card"
                      ? finalPaymentAmount
                      : 0,
                },
              },
            ],
            { session },
          );
        }
      }

      await session.commitTransaction();

      res.status(201).json({
        message: finalDoctorId
          ? "Patient registered successfully with appointment"
          : "Patient registered successfully",
        patient: {
          id: user._id,
          _id: user._id,
          name: user.name,
          mrn: patientProfile.mrn,
          mobile: user.mobile,
          hospitals: user.hospitals || (user.hospital ? [user.hospital] : []),
        },
        visitId: appointment?._id || null,
        appointmentId: appointment?.appointmentId || null,
        credentials: {
          username: mobile,
          password: generatedPassword,
        },
      });
    } catch (error: any) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      session.endSession();
    }
  },
);

export const getPatients = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { search, q, page = 1, limit = 10, type } = req.query;
    const searchTerm = search || q;

    const hospitalId = new mongoose.Types.ObjectId((req as any).user.hospital);

    const query: any = { hospitals: hospitalId };
    if (searchTerm) {
      // Find profiles that match MRN to include those users in the search
      const profileMatches = await PatientProfile.find({
        hospital: hospitalId,
        mrn: { $regex: searchTerm, $options: "i" },
      }).select("user");

      const matchedUserIds = profileMatches.map((p) => p.user);

      // Use $and to ensure the search $or doesn't conflict with base criteria
      const searchCriteria = {
        $or: [
          { name: { $regex: searchTerm, $options: "i" } },
          { mobile: { $regex: searchTerm, $options: "i" } },
          { _id: { $in: matchedUserIds } },
        ],
      };

      // Convert existing query into an $and array if it has hospital/role
      const baseCriteria = { hospitals: hospitalId };

      // Overwrite query with combined criteria
      Object.keys(query).forEach((key) => delete query[key]);
      query.$and = [baseCriteria, searchCriteria];
    }

    // Find all patients who have an ACTIVE admission in THIS hospital
    const ipdAdmissions = await IPDAdmission.find({
      hospital: hospitalId,
      status: { $in: ["Active", "Discharge Initiated"] },
    }).select("patient globalPatientId");

    const admissionUserIds = new Set<string>();
    const potentialProfileIds: mongoose.Types.ObjectId[] = [];

    ipdAdmissions.forEach((adm) => {
      if (adm.patient) {
        const idStr = adm.patient.toString();
        if (mongoose.Types.ObjectId.isValid(idStr)) {
          admissionUserIds.add(idStr);
          potentialProfileIds.push(new mongoose.Types.ObjectId(idStr));
        }
      }
      if (adm.globalPatientId) {
        const idStr = adm.globalPatientId.toString();
        if (mongoose.Types.ObjectId.isValid(idStr)) {
          admissionUserIds.add(idStr);
        }
      }
    });

    // Resolve any Profile IDs to User IDs (just in case)
    const mappingProfiles = await PatientProfile.find({
      hospital: hospitalId, // STRICT HOSPITAL LOCK
      _id: { $in: potentialProfileIds },
    }).select("user");

    mappingProfiles.forEach((p) => {
      if (p.user) admissionUserIds.add(p.user.toString());
    });

    const resolvedUserIds = Array.from(admissionUserIds);
    const activePatientIdSet = admissionUserIds;

    if (type === "ipd") {
      query._id = { $in: resolvedUserIds };
      delete query.hospitals;
    } else if (type === "opd") {
      query._id = { $nin: resolvedUserIds };
      query.hospitals = hospitalId;
    } else {
      // 'all' includes local patients OR anyone admitted here
      // ✅ GLOBAL PATIENT FIX: If searching, allow finding ANY patient by mobile/name
      if (searchTerm) {
        // Search criteria already has the $or for name/mobile
        delete query.hospitals;
      } else {
        query.$or = [
          { hospitals: hospitalId },
          { _id: { $in: resolvedUserIds } },
        ];
        delete query.hospitals;
      }
    }

    const total = await Patient.countDocuments(query);
    const patients = await Patient.find(query)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .select("-password -refreshTokens")
      .sort({ createdAt: -1 });

    const patientsWithDetails = await Promise.all(
      patients.map(async (p) => {
        const profile = await PatientProfile.findOne({ user: p._id }).select(
          "mrn lastVisit gender customId dob maritalStatus bloodGroup address alternateNumber emergencyContactEmail allergies medicalHistory",
        );

        // Check if patient belongs to IPD in this hospital
        const isIPD = activePatientIdSet.has(p._id.toString());

        return {
          ...p.toObject(),
          profile,
          isIPD,
          activeAdmission: isIPD
            ? await IPDAdmission.findOne({
              hospital: hospitalId,
              status: { $in: ["Active", "Discharge Initiated"] },
              $or: [{ patient: p._id }, { patient: profile?._id }],
            }).select("_id admissionId admissionType")
            : null,
          activeConsultation: await Appointment.findOne({
            patient: p._id,
            status: "in-progress",
          }).select("_id status"),
        };
      }),
    );

    res.json({
      data: patientsWithDetails,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  },
);

export const getPatientById = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { patientId } = req.params;
    const hospitalId = (req as any).user?.hospital;
    let user: any = null;
    let profile: any = null;

    if (mongoose.Types.ObjectId.isValid(patientId)) {
      // Bypass tenant isolation to find global patients
      user = await Patient.findOne({
        _id: patientId,
      }).select("-password -refreshTokens");

      if (user) {
        // Fetch the profile for the CURRENT hospital
        profile = await PatientProfile.findOne({
          user: user._id,
          hospital: hospitalId,
        });

        // If not found, fallback to ANY profile just to get basic details if needed
        // but we'll prioritize the hospital-specific one
        if (!profile) {
          profile = await PatientProfile.findOne({ user: user._id });
        }
      } else {
        // Search by profile ID if patient ID not found
        profile = await PatientProfile.findById(patientId);
        if (profile) {
          user = await Patient.findOne({
            _id: profile.user,
          }).select("-password -refreshTokens");
        }
      }
    }

    if (!user) throw new ApiError(404, "Patient not found");

    // Hospital isolation check - allow if patient belongs to this hospital, has a profile here, or has an admission here
    if (hospitalId && user.hospitals) {
      const isHospitalPresent = user.hospitals.some(
        (h: any) => h.toString() === hospitalId.toString(),
      );

      // Check if patient has a profile in this hospital (authorized via registration)
      const hasProfile = await PatientProfile.findOne({
        user: user._id,
        hospital: hospitalId,
      });

      // Check if patient has an admission in this hospital
      const hasAdmission = await IPDAdmission.findOne({
        hospital: hospitalId,
        $or: [{ patient: user._id }, { patient: profile?._id }],
      });

      if (!isHospitalPresent && !hasAdmission && !hasProfile) {
        throw new ApiError(
          403,
          "Patient not found or not authorized for this hospital",
        );
      }
    }

    const lastVisit = await Appointment.findOne({ patient: user._id }).sort({
      date: -1,
    });

    // Check for active IPD admission in current hospital
    const activeAdmission = hospitalId
      ? await IPDAdmission.findOne({
        hospital: hospitalId,
        $or: [{ patient: user._id }, { patient: profile?._id }],
        status: { $in: ["Active", "Discharge Initiated"] },
      })
        .select("_id admissionId status")
        .sort({ createdAt: -1 })
      : null;

    // Check for active 'in-progress' consultation
    const activeConsultation = await Appointment.findOne({
      patient: user._id,
      status: "in-progress",
    })
      .select("_id status doctor startTime")
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name" },
      });

    res.json({ user, profile, lastVisit, activeAdmission, activeConsultation });
  },
);

export const updatePatient = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { patientId } = req.params;
    const hospitalId = (req as any).user?.hospital;
    const {
      honorific,
      name,
      mobile,
      email,
      address,
      gender,
      dob,
      maritalStatus,
      bloodGroup,
      height,
      weight,
      bloodPressure,
      bp,
      temperature,
      pulse,
      pulseRate,
      spO2,
      spo2,
      sugar,
      age,
      medicalHistory,
      allergies,
      conditions,
      medications,
      emergencyContact,
      emergencyContactEmail,
    } = req.body;

    const vitalsInput = req.body.vitals || {};

    const user = await Patient.findOne({
      _id: patientId,
    });
    if (!user) throw new ApiError(404, "Patient not found");

    // Hospital isolation check
    if (hospitalId && user.hospitals) {
      const isHospitalPresent = user.hospitals.some(
        (h: any) => h.toString() === hospitalId.toString(),
      );

      const hasProfile = await PatientProfile.findOne({
        user: user._id,
        hospital: hospitalId,
      });

      if (!isHospitalPresent && !hasProfile) {
        throw new ApiError(403, "Not authorized to update this patient");
      }
    }

    if (name) user.name = name;
    if (mobile) user.mobile = mobile;
    if (email) user.email = email;
    await user.save();

    let profile = await PatientProfile.findOne({ user: patientId });
    if (!profile) {
      profile = new PatientProfile({
        user: patientId,
        hospital: (req.user as any).hospital,
      });
    }

    // Update new fields
    if (honorific !== undefined) profile.honorific = honorific;
    if (emergencyContact !== undefined)
      profile.alternateNumber = emergencyContact;
    if (emergencyContactEmail !== undefined)
      profile.emergencyContactEmail = emergencyContactEmail;

    if (address !== undefined) profile.address = address;
    if (gender !== undefined) profile.gender = gender;

    if (dob !== undefined) {
      profile.dob = new Date(dob);
    } else if (age !== undefined) {
      const calculatedDob = new Date();
      calculatedDob.setFullYear(calculatedDob.getFullYear() - Number(age));
      profile.dob = calculatedDob;
    }

    if (maritalStatus !== undefined) profile.maritalStatus = maritalStatus;
    if (bloodGroup !== undefined) profile.bloodGroup = bloodGroup;
    if (height !== undefined) profile.height = height;
    if (weight !== undefined) profile.weight = weight;

    // Handle Vitals
    if (bloodPressure || bp || vitalsInput.bloodPressure || vitalsInput.bp)
      profile.bloodPressure =
        bloodPressure || bp || vitalsInput.bloodPressure || vitalsInput.bp;
    if (temperature || vitalsInput.temperature)
      profile.temperature = temperature || vitalsInput.temperature;
    if (pulse || pulseRate || vitalsInput.pulse || vitalsInput.pulseRate)
      profile.pulse =
        pulse || pulseRate || vitalsInput.pulse || vitalsInput.pulseRate;
    if (spO2 || spo2 || vitalsInput.spO2 || vitalsInput.spo2)
      profile.spO2 = spO2 || spo2 || vitalsInput.spO2 || vitalsInput.spo2;
    if (sugar || vitalsInput.sugar) profile.sugar = sugar || vitalsInput.sugar;

    if (medicalHistory !== undefined) profile.medicalHistory = medicalHistory;
    if (allergies !== undefined) profile.allergies = allergies;
    if (conditions !== undefined) profile.conditions = conditions;
    if (medications !== undefined) profile.medications = medications;

    await profile.save();

    // Invalidate IPD Bed Cache if patient is currently admitted
    try {
      const activeAdmission = await IPDAdmission.findOne({
        $or: [{ patient: patientId }, { patient: profile._id }],
        status: "Active",
      });
      if (activeAdmission) {
        const occupancy = await BedOccupancy.findOne({
          admission: activeAdmission._id,
          endDate: { $exists: false },
        });
        if (occupancy) {
          await invalidateIPDCache(
            (req.user as any).hospital,
            occupancy.bed.toString(),
          );
        }
      }
    } catch (err) {
      console.error("Cache invalidation failed in updatePatient:", err);
    }

    res.json({ message: "Patient updated successfully", profile });
  },
);

export const deletePatient = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { patientId } = req.params;
    const hospitalId = (req as any).user?.hospital;

    const user = await Patient.findById(patientId);
    if (!user) throw new ApiError(404, "Patient not found");

    // Hospital isolation check - ensure patient belongs to user's hospital
    if (hospitalId && user.hospitals) {
      const isHospitalPresent = user.hospitals.some(
        (h: any) => h.toString() === hospitalId.toString(),
      );
      if (!isHospitalPresent) {
        throw new ApiError(403, "Not authorized to delete this patient");
      }
    }

    await Patient.findByIdAndDelete(patientId);
    await PatientProfile.findOneAndDelete({ user: patientId });
    await Appointment.deleteMany({ patient: patientId });
    res.json({ message: "Patient and associated records deleted permanently" });
  },
);

export const getTodayVisits = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const helpdesk = req.user as any;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    let visits = await Appointment.find({
      hospital: helpdesk.hospital,
      $or: [
        { date: { $gte: startOfDay, $lte: endOfDay } },
        { status: { $in: ["pending", "confirmed", "in-progress", "Booked"] } },
      ],
    })
      .populate("patient", "name mobile")
      .populate("doctor", "firstName lastName")
      .sort({ date: 1, createdAt: 1 });

    visits = visits.filter((v) => v.patient);

    res.json(visits);
  },
);

export const getPatientVisitHistory = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { patientId } = req.params;
    const hospitalId = (req as any).user?.hospital;

    // Hospital isolation check - filter visits by hospital
    const visitFilter: any = { patient: patientId };
    if (hospitalId) {
      visitFilter.hospital = hospitalId;
    }

    const visits = await Appointment.find(visitFilter)
      .populate("doctor", "firstName lastName")
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name" },
      })
      .sort({ date: -1 });
    res.json(visits);
  },
);

export const getActiveAppointments = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const helpdesk = req.user as any;
    const activeStatuses = ["pending", "confirmed", "in-progress", "Booked"]; // Added 'Booked'
    let visits = await Appointment.find({
      hospital: helpdesk.hospital,
      status: { $in: activeStatuses },
    })
      .populate("patient", "name mobile")
      .populate("doctor", "firstName lastName")
      .populate({ path: "doctor", populate: { path: "user", select: "name" } })
      .populate("createdBy", "name mobile")
      .sort({ date: 1 });
    visits = visits.filter((v) => v.patient);
    res.json(visits);
  },
);

export const getAllAppointments = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const helpdesk = req.user as any;
    let visits = await Appointment.find({
      hospital: helpdesk.hospital,
    })
      .populate("patient", "name mobile")
      .populate("doctor", "firstName lastName")
      .populate({ path: "doctor", populate: { path: "user", select: "name" } })
      .populate("createdBy", "name mobile")
      .sort({ date: -1 });
    visits = visits.filter((v) => v.patient);
    res.json(visits);
  },
);

/**
 * Get IPD admissions for a specific patient
 * Used for generating receipts with correct payment information
 */
export const getPatientIPDAdmissions = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const { patientId } = req.params;
    const hospitalId = (req as any).user?.hospital;

    // Hospital isolation check - robust patient lookup across both collections
    if (hospitalId) {
      const [user, patient] = await Promise.all([
        User.findById(patientId),
        Patient.findById(patientId)
      ]);
      
      const targetUser = user || patient;
      if (!targetUser) {
        // Instead of throwing 404, return empty admissions for safety in Helpdesk UI
        return res.json({ admissions: [] });
      }

      const userHospitalStr = ((targetUser as any).hospital || ((targetUser as any).hospitals && (targetUser as any).hospitals[0]))?.toString();
      const reqHospitalStr = hospitalId.toString();

      // If the patient belongs to another hospital and has no relation to this one, then block
      // But verify if they have a profile/admission in this hospital first
      const hasLocalRelation = await Promise.all([
         PatientProfile.exists({ user: patientId, hospital: hospitalId }),
         IPDAdmission.exists({ patient: patientId, hospital: hospitalId })
      ]);

      if (userHospitalStr !== reqHospitalStr && !hasLocalRelation.some(r => r)) {
        throw new ApiError(
          403,
          "Not authorized to access this patient's admissions",
        );
      }
    }

    // Fetch actual IPD Admission records (not appointments) to get the real payment data
    const admissions = await IPDAdmission.find({
      patient: patientId,
      hospital: hospitalId,
      status: { $in: ["Active", "Discharged", "Discharge Initiated"] },
    })
      .populate("primaryDoctor", "name specialization")
      .populate({
        path: "primaryDoctor",
        populate: { path: "user", select: "name" },
      })
      .populate("hospital", "name address phone email")
      .populate("patient", "name email phone")
      .select(
        "admissionId admissionDate admissionType status amount paymentMethod paymentStatus vitals diet clinicalNotes",
      )
      .sort({ admissionDate: -1 })
      .lean();

    console.log(
      `[getPatientIPDAdmissions] Found ${admissions.length} IPD admissions for patient ${patientId}`,
    );
    if (admissions.length > 0) {
      console.log(`[getPatientIPDAdmissions] First admission payment:`, {
        admissionId: admissions[0].admissionId,
        amount: admissions[0].amount,
        paymentMethod: admissions[0].paymentMethod,
        paymentStatus: admissions[0].paymentStatus,
      });
    }

    res.json({ admissions });
  },
);
