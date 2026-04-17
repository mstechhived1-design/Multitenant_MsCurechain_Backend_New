import { Request, Response } from "express";
import Appointment from "../Models/Appointment.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import User from "../../Auth/Models/User.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import Patient from "../../Patient/Models/Patient.js";
// import HelpDesk from "../../Helpdesk/Models/HelpDesk.js";
import Leave from "../../Leave/Models/Leave.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import { createNotification } from "../../Notification/Controllers/notificationController.js";
import { generateSlots } from "../../utils/slotUtils.js";
import { AppointmentRequest } from "../types/index.js";
import { Server } from "socket.io";
// import Stripe from "stripe";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Transaction from "../../Admin/Models/Transaction.js";
import IPDAdmission from "../../IPD/Models/IPDAdmission.js";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import { invalidateDoctorCache } from "../../utils/cacheInvalidation.js";
import { generateTransactionId, generateReceiptNumber } from "../../utils/idGenerator.js";

dotenv.config();

// Custom Request Interface to include io
interface RequestWithIO extends AppointmentRequest {
  io?: Server;
}

export const startAppointmentCleanupTask = (io: Server) => {
  setInterval(async () => {
    try {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      const expiredAppointments = await (
        Appointment.find({
          status: "pending",
          createdAt: { $lt: twoMinutesAgo },
        }) as any
      )
        .unscoped()
        .populate("patient");

      if (expiredAppointments.length > 0) {
        console.log(
          `Found ${expiredAppointments.length} expired pending appointments.`,
        );
      }

      for (const app of expiredAppointments) {
        await (Appointment.findByIdAndDelete(app._id) as any).unscoped();

        if (app.patient) {
          const message = "Doctor is not available";
          const patientId = (app.patient as any)._id; // Cast because populate might return user doc

          await createNotification({ user: { _id: "SYSTEM" } } as any, {
            hospital: app.hospital,
            recipient: patientId,
            sender: app.doctor as any,
            type: "appointment_cancelled",
            message: message,
            relatedId: app._id as any,
          });

          io.to(`patient_${patientId}`).emit("appointment_cancelled", {
            appointmentId: app._id,
            message: message,
          });
        }
      }
    } catch (err) {
      console.error("Error in appointment cleanup task:", err);
    }
  }, 60 * 1000);
};

export const bookAppointment = asyncHandler(
  async (req: Request, res: Response) => {
    const bookingReq = req as unknown as RequestWithIO;
    try {
      const {
        doctorId,
        date,
        timeSlot,
        startTime: bodyStartTime,
        endTime: bodyEndTime,
        symptoms,
        reason,
        type,
        urgency,
        vitals,
      } = bookingReq.body;

      // Decide patientId: if helpdesk/admin, take from body, else use logged in user's ID
      let patientId = bookingReq.user!._id;
      if (
        ["helpdesk", "hospital-admin", "super-admin"].includes(
          bookingReq.user!.role,
        ) &&
        bookingReq.body.patientId
      ) {
        patientId = bookingReq.body.patientId;
      }

      // CRITICAL FIX: Ensure patientId is the USER ID, not the PatientProfile ID.
      // If it's a PatientProfile ID, we need to find the User ID.
      const potentialProfile = await PatientProfile.findById(patientId);
      if (potentialProfile && potentialProfile.user) {
        console.log(
          `[Booking] Resolved PatientProfile ID ${patientId} to User ID ${potentialProfile.user}`,
        );
        patientId = potentialProfile.user as any;
      }

      let resolvedDoctor =
        await DoctorProfile.findById(doctorId).populate("user");
      let finalDoctorId = doctorId;

      if (!resolvedDoctor) {
        resolvedDoctor = await DoctorProfile.findOne({
          user: doctorId,
        }).populate("user");
        if (resolvedDoctor) {
          finalDoctorId = resolvedDoctor._id as any;
        } else {
          return res.status(404).json({ message: "Doctor not found" });
        }
      }
      const doctor = resolvedDoctor;

      // Patients shouldn't book with themselves (if they are also doctors), but helpdesk can book for any patient.
      if (
        bookingReq.user!._id.toString() === (doctor.user as any)._id.toString()
      ) {
        return res
          .status(400)
          .json({ message: "You cannot book an appointment with yourself." });
      }

      const targetHospitalId = (bookingReq as any).user?.hospital;
      if (!targetHospitalId)
        return res
          .status(400)
          .json({ message: "Hospital association not found in session" });

      const hospital = await Hospital.findById(targetHospitalId);
      if (!hospital)
        return res
          .status(404)
          .json({ message: "Clinic/Hospital settings not found" });

      // Support both "startTime - endTime" format and individual fields
      let reqStart = bodyStartTime;
      let reqEnd = bodyEndTime;

      if (timeSlot && timeSlot.includes(" - ")) {
        const parts = timeSlot.split(" - ");
        reqStart = parts[0];
        reqEnd = parts[1];
      }

      if (!reqStart || !reqEnd) {
        // If no time is provided, we still allow booking in queue-based system
        reqStart = new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        reqEnd = reqStart;
      }

      const dayName = new Date(date).toLocaleDateString("en-US", {
        weekday: "long",
      });

      let availability: any = doctor.availability?.find(
        (a: any) => a.days && a.days.includes(dayName),
      );
      let startTimeVal, endTimeVal, breakStartVal, breakEndVal;

      if (availability) {
        startTimeVal = availability.startTime;
        endTimeVal = availability.endTime;
        breakStartVal = availability.breakStart;
        breakEndVal = availability.breakEnd;
      } else {
        // If no availability set or doctor not available on this day,
        // use default hours (9 AM - 6 PM) for walk-in bookings
        startTimeVal = "09:00 AM";
        endTimeVal = "06:00 PM";
        breakStartVal = null;
        breakEndVal = null;
      }

      // REMOVED: No longer blocking bookings on unavailable days
      // if (!availability) {
      //     return res.status(400).json({ message: `Doctor is not available on ${dayName}` });
      // }

      // CHECK FOR EXISTING ACTIVE APPOINTMENT WITH SAME DOCTOR ON SAME DAY
      // We block if they are already in queue (pending/confirmed/in-progress)
      const startOfDayCheck = new Date(date);
      startOfDayCheck.setHours(0, 0, 0, 0);
      const endOfDayCheck = new Date(date);
      endOfDayCheck.setHours(23, 59, 59, 999);

      const existingActiveBooking = await Appointment.findOne({
        patient: patientId,
        doctor: finalDoctorId,
        date: {
          $gte: startOfDayCheck,
          $lte: endOfDayCheck,
        },
        status: {
          $in: ["pending", "confirmed", "in-progress", "Booked", "waiting"],
        },
        // If editing an appointment, exclude itself (not relevant for create, but good practice)
      });

      if (existingActiveBooking) {
        return res.status(400).json({
          message:
            "Patient already has an active appointment with this doctor today.",
        });
      }

      const validSlots = generateSlots(
        startTimeVal,
        endTimeVal,
        breakStartVal,
        breakEndVal,
      );

      let finalStartTime = reqStart;
      let finalEndTime = reqEnd;

      // Try to find exact match in generated 5-min slots
      const exactMatch = validSlots.find(
        (s) => s.startTime === reqStart && s.endTime === reqEnd,
      );

      if (!exactMatch) {
        // WALK-IN BOOKING: Accept any time without validation
        // No need to check if slot exists in generated slots
        // Just use the provided time or current time
        finalStartTime = reqStart;
        finalEndTime = reqEnd;

        // REMOVED: Time slot validation for walk-in bookings
        // The helpdesk should be able to book at any time
      } else if (!exactMatch && reqStart && reqEnd) {
        // If manual time provided but doesn't match 5-min slots, we still allow it
        finalStartTime = reqStart;
        finalEndTime = reqEnd;
      }

      // REMOVED: Duplicate booking check - Allow multiple bookings at same time for queue system
      // const existing = await Appointment.findOne({
      //     doctor: doctorId,
      //     hospital: targetHospitalId,
      //     date: new Date(date),
      //     startTime: finalStartTime,
      //     status: { $ne: "cancelled" }
      // });
      //
      // if (existing) {
      //     return res.status(400).json({ message: "Time slot already booked" });
      // }

      const startTime = finalStartTime;
      const endTime = finalEndTime;

      const patientProfile = await PatientProfile.findOne({ user: patientId });
      let mrn: string | null = null;

      // Capture extra details if passed in body (e.g. from helpdesk booking)
      const {
        honorific,
        address,
        emergencyContact,
        bloodGroup,
        maritalStatus,
        medicalHistory,
        allergies,
      } = bookingReq.body;

      if (patientProfile) {
        if (patientProfile.mrn) {
          mrn = patientProfile.mrn;
          patientProfile.lastVisit = new Date();
        } else {
          const initials = hospital.name
            .split(" ")
            .map((n: string) => n[0])
            .join("")
            .toUpperCase();
          const randomNum = Math.floor(100 + Math.random() * 900);
          const year = new Date().getFullYear();
          mrn = `${initials}${randomNum}${year}`;
          patientProfile.hospital = targetHospitalId;
          patientProfile.mrn = mrn;
          patientProfile.lastVisit = new Date();
        }

        // Update profile with missing details if provided
        if (honorific) patientProfile.honorific = honorific;
        else if (!patientProfile.honorific && patientProfile.gender) {
          patientProfile.honorific =
            patientProfile.gender === "male" ? "Mr" : "Ms";
        }

        if (address) patientProfile.address = address;
        if (emergencyContact) patientProfile.alternateNumber = emergencyContact;
        if (bloodGroup) patientProfile.bloodGroup = bloodGroup;
        if (maritalStatus) patientProfile.maritalStatus = maritalStatus;

        // Append history/allergies if new ones are added (check for duplicates)
        if (medicalHistory && medicalHistory !== "None") {
          const currentHistory = patientProfile.medicalHistory || "";
          if (!currentHistory.includes(medicalHistory)) {
            patientProfile.medicalHistory =
              currentHistory && currentHistory !== "None"
                ? `${currentHistory}, ${medicalHistory}`
                : medicalHistory;
          }
        }
        if (allergies && allergies !== "None") {
          const currentAllergies = patientProfile.allergies
            ? Array.isArray(patientProfile.allergies)
              ? patientProfile.allergies.join(", ")
              : patientProfile.allergies
            : "";

          // If it's an array field in schema but treated as string here, handle carefully.
          // Assuming it might be a string based on usage.
          // If the incoming allergy is not part of the current string, append it.
          if (!currentAllergies.includes(allergies)) {
            patientProfile.allergies =
              currentAllergies && currentAllergies !== "None"
                ? `${currentAllergies}, ${allergies}`
                : allergies;
          }
        }

        await patientProfile.save();
      }

      const consultationFee =
        bookingReq.body.amount !== undefined
          ? bookingReq.body.amount
          : doctor.consultationFee || 0;
      let finalPaymentStatus = bookingReq.body.paymentStatus || "Paid";
      let finalPaymentMethod = bookingReq.body.paymentMethod || "cash";
      let finalAmount = consultationFee;

      // Check if this is an IPD appointment and sync payment from existing admission
      const appointmentType = type || "offline";
      if (appointmentType.toUpperCase() === "IPD") {
        // Look for existing IPD admission for this patient
        const existingAdmission = await IPDAdmission.findOne({
          patient: patientId,
          hospital: targetHospitalId,
          status: "Active",
        }).sort({ createdAt: -1 });

        if (existingAdmission) {
          // Use payment details from the IPD admission
          finalAmount = existingAdmission.amount || 0;
          finalPaymentMethod = existingAdmission.paymentMethod || "cash";
          finalPaymentStatus = existingAdmission.paymentStatus || "pending";
          console.log(
            `[Book Appointment] Found IPD admission ${existingAdmission.admissionId}, syncing payment: ₹${finalAmount}`,
          );
        } else {
          console.log(
            `[Book Appointment] No existing IPD admission found for patient ${patientId}`,
          );
        }
      }

      // Handle Vitals: use provided or fallback to profile
      // Map frontend keys (bp, spo2) to backend Schema keys (bloodPressure, spO2)
      const incomingVitals = vitals || {};
      const finalVitals = {
        bloodPressure:
          incomingVitals.bp ||
          incomingVitals.bloodPressure ||
          patientProfile?.bloodPressure,
        temperature: incomingVitals.temperature || patientProfile?.temperature,
        pulse: incomingVitals.pulse || patientProfile?.pulse,
        spO2:
          incomingVitals.spo2 || incomingVitals.spO2 || patientProfile?.spO2,
        height: incomingVitals.height || patientProfile?.height,
        weight: incomingVitals.weight || patientProfile?.weight,
        glucose:
          incomingVitals.glucose ||
          incomingVitals.sugar ||
          patientProfile?.glucose ||
          patientProfile?.sugar,
      };

      // Handle Notes/Symptoms mapping
      // Frontend sends 'notes', Schema expects 'reason' or 'symptoms'
      const finalReason = reason || bookingReq.body.notes;
      const finalSymptoms = symptoms || (finalReason ? [finalReason] : []);

      let paymentStatus = "not_required";
      let stripeSessionId = null;
      let paymentUrl = null;

      const appTypePrefix = appointmentType.toUpperCase() === "IPD" ? "IPD" : 
                           (appointmentType.toUpperCase() === "OPD" || appointmentType === "offline" ? "OPD" : "APT");
      const transactionId = await generateTransactionId(targetHospitalId, hospital.name, appTypePrefix as any);
      const receiptNumber = (finalPaymentStatus === "Paid" || finalPaymentStatus === "paid") ? await generateReceiptNumber(targetHospitalId) : undefined;

      const appointment = await Appointment.create({
        patient: patientId,
        globalPatientId: patientId,
        doctor: finalDoctorId,
        hospital: targetHospitalId,
        date: new Date(date),
        appointmentTime: startTime, // Set appointmentTime for compatibility
        appointmentId: transactionId, // Use new unique ID format
        startTime,
        endTime,
        symptoms: finalSymptoms,
        reason: finalReason,
        type: appointmentType,
        urgency: urgency || "non-urgent",
        mrn,
        status:
          appointmentType.toUpperCase() === "IPD" ? "confirmed" : "Booked",
        patientDetails: bookingReq.body.patientDetails,
        paymentStatus: finalPaymentStatus,
        payment: {
          amount: finalAmount,
          paymentMethod: finalPaymentMethod,
          paymentStatus: finalPaymentStatus,
          receiptNumber: receiptNumber, // Store generated receipt number
        },
        amount: finalAmount,
        vitals: finalVitals,
      });

      // Create Transaction for Booking
      if (consultationFee > 0) {
        await Transaction.create({
          user: patientId,
          userModel: "Patient", // Most appointment bookings are for patients
          hospital: targetHospitalId,
          amount: consultationFee,
          type:
            appointmentType.toUpperCase() === "IPD"
              ? "ipd_advance"
              : "appointment_booking",
          status: finalPaymentStatus === "Paid" ? "completed" : "pending",
          referenceId: appointment._id,
          transactionId: transactionId,
          receiptNumber: receiptNumber,
          date: new Date(),
          paymentMode: bookingReq.body.paymentMethod || "cash",
          paymentDetails: {
            cash:
              bookingReq.body.paymentMethod === "cash" ? consultationFee : 0,
            upi: bookingReq.body.paymentMethod === "upi" ? consultationFee : 0,
            card:
              bookingReq.body.paymentMethod === "card" ? consultationFee : 0,
          },
        });
      }

      if (paymentStatus === "not_required") {
        if (doctor.user) {
          const patient = await Patient.findById(patientId);
          const patientName = patient ? patient.name : "Patient";

          await createNotification(bookingReq as any, {
            hospital: targetHospitalId,
            recipient: (doctor.user as any)._id,
            sender: bookingReq.user!._id,
            type: "appointment_request",
            message: `New appointment request from ${patientName} for ${date} at ${startTime} - ${endTime}`,
            relatedId: appointment._id as any,
          });

          if (bookingReq.io) {
            // Refresh Dashboard Stats
            bookingReq.io
              .to(`doctor_${(doctor.user as any)._id}`)
              .emit("dashboard:update", {
                message: `New appointment received`,
                appointmentId: appointment._id,
              });
          }
        }

        const helpdeskUsers = await User.find({ role: "helpdesk", hospital: targetHospitalId }); // Find helpdesk users of this hospital only

        for (const hdUser of helpdeskUsers) {
          await createNotification(bookingReq as any, {
            hospital: targetHospitalId,
            recipient: hdUser._id,
            sender: bookingReq.user!._id,
            type: "appointment_request",
            message: `New appointment request for ${date} at ${startTime} - ${endTime}`,
            relatedId: appointment._id as any,
          });
        }
      }

      res.status(201).json({
        message: paymentUrl ? "Payment required" : "Appointment request sent",
        appointment,
        paymentUrl,
      });
    } catch (err: any) {
      console.error("Booking Error:", err);
      res.status(500).json({ message: "Server error", error: err.message });
    }
  },
);

export const checkAvailability = asyncHandler(
  async (req: Request, res: Response) => {
    const availabilityReq = req as unknown as AppointmentRequest;
    try {
      const { doctorId, hospitalId, date } = availabilityReq.query;

      console.log("checkAvailability called with:", {
        doctorId,
        hospitalId,
        date,
      });

      if (!doctorId || !hospitalId || !date) {
        console.log("Missing parameters:", { doctorId, hospitalId, date });
        return res.status(400).json({ message: "Missing params" });
      }

      const isHelpdesk =
        availabilityReq.user!.role === "helpdesk" ||
        availabilityReq.user!.role === "hospital-admin";

      const doctor = await DoctorProfile.findById(doctorId).populate("user");
      if (!doctor) {
        console.log("Doctor not found:", doctorId);
        return res.status(404).json({ message: "Doctor not found" });
      }

      console.log("Doctor found:", {
        id: doctor._id,
        name: (doctor.user as any)?.name,
        hasAvailability: !!doctor.availability,
        availabilityCount: doctor.availability?.length || 0,
      });

      const queryDate = new Date(date as string);
      const startOfDay = new Date(queryDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(queryDate.setHours(23, 59, 59, 999));

      const leave = await Leave.findOne({
        requester: (doctor.user as any)._id,
        status: "approved",
        $or: [{ startDate: { $lte: endOfDay }, endDate: { $gte: startOfDay } }],
      });

      if (leave) {
        return res.json({
          availableSlots: [],
          bookedSlots: [],
          message: "Doctor is on leave",
          isLeave: true,
        });
      }

      const duration = doctor.consultationDuration || 5; // Default to 5 mins if not set

      const days = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const dayName = days[queryDate.getDay()];

      // Find availability for this day
      const availability = doctor.availability?.find(
        (a: any) => a.days && a.days.includes(dayName),
      );

      if (!availability) {
        return res.json({
          availableSlots: [],
          bookedSlots: [],
          message: "Doctor not available on this day",
          isLeave: false,
        });
      }

      let startTimeVal = availability.startTime;
      let endTimeVal = availability.endTime;
      let breakStartVal = availability.breakStart;
      let breakEndVal = availability.breakEnd;

      console.log("Doctor availability:", {
        startTimeVal,
        endTimeVal,
        breakStartVal,
        breakEndVal,
      });

      if (!startTimeVal || !endTimeVal) {
        console.log(
          "Invalid availability configuration - missing start or end time",
        );
        return res.json({
          availableSlots: [],
          bookedSlots: [],
          message: "Doctor availability not properly configured",
        });
      }

      const allSlots = generateSlots(
        startTimeVal,
        endTimeVal,
        breakStartVal,
        breakEndVal,
        duration,
      );

      console.log("Generated slots count:", allSlots.length);

      const appointments = await Appointment.find({
        doctor: doctorId,
        hospital: hospitalId,
        date: new Date(date as string),
        status: { $ne: "cancelled" },
      }).select("startTime endTime");

      console.log("Found appointments:", appointments.length);

      const bookedStartTimes = appointments.map((a) => a.startTime);
      const hourlyBlocks: any[] = [];
      const slotsByHour: any = {};

      allSlots.forEach((slot) => {
        const [time, modifier] = slot.startTime.split(" ");
        let [h, m]: any = time.split(":").map(Number);
        let hour24 = h;
        if (modifier === "PM" && h < 12) hour24 += 12;
        if (modifier === "AM" && h === 12) hour24 = 0;

        const hourKey = `${hour24}`;
        if (!slotsByHour[hourKey]) {
          slotsByHour[hourKey] = {
            hour24,
            displayStart: `${h}:00 ${modifier}`,
            displayEnd: `${h === 12 ? 1 : h + 1 > 12 ? h + 1 - 12 : h + 1}:00 ${modifier === "AM" && h === 11 ? "PM" : modifier === "PM" && h === 11 ? "AM" : modifier}`,
            slots: [],
          };
        }
        slotsByHour[hourKey].slots.push(slot);
      });

      const bookedCountByHour: any = {};
      appointments.forEach((app) => {
        if (app.startTime) {
          const [time, modifier] = app.startTime.split(" ");
          let [h, m]: any = time.split(":").map(Number);
          if (modifier === "PM" && h < 12) h += 12;
          if (modifier === "AM" && h === 12) h = 0;
          bookedCountByHour[h] = (bookedCountByHour[h] || 0) + 1;
        }
      });

      Object.values(slotsByHour)
        .sort((a: any, b: any) => a.hour24 - b.hour24)
        .forEach((block: any) => {
          const HOURLY_LIMIT = 12;
          const totalCapacity = Math.min(block.slots.length, HOURLY_LIMIT);
          const bookedCount = block.slots.filter((slot: any) =>
            bookedStartTimes.includes(slot.startTime),
          ).length;
          const isFull = bookedCount >= totalCapacity;

          hourlyBlocks.push({
            timeSlot: `${block.displayStart} - ${block.displayEnd}`,
            totalCapacity,
            bookedCount,
            isFull,
            availableCount: Math.max(0, totalCapacity - bookedCount),
          });
        });

      console.log("Returning hourly blocks:", hourlyBlocks.length);

      res.json({
        slots: hourlyBlocks,
        bookedCountByHour: isHelpdesk ? bookedCountByHour : undefined,
      });
    } catch (err: any) {
      console.error("checkAvailability error:", err);
      console.error("Stack trace:", err.stack);
      res.status(500).json({
        message: err.message || "Server error",
        error: err.toString(),
      });
    }
  },
);

export const updateAppointmentStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const updateReq = req as unknown as RequestWithIO;
    try {
      const { id } = updateReq.params;
      const { status, reason } = updateReq.body;

      if (
        ![
          "confirmed",
          "rejected",
          "cancelled",
          "completed",
          "in-progress",
        ].includes(status)
      ) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const appointment = await Appointment.findByIdAndUpdate(
        id,
        {
          status:
            status === "rejected" || status === "cancelled"
              ? "cancelled"
              : status,
        },
        { new: true },
      )
        .populate("doctor")
        .populate("hospital")
        .populate("patient");

      if (!appointment)
        return res.status(404).json({ message: "Appointment not found" });

      const dateStr = new Date(appointment.date).toDateString();
      const timeSlotStr = `${appointment.startTime} - ${appointment.endTime}`;

      if (appointment.patient) {
        const patientObj = appointment.patient as any;
        const patientId = patientObj._id || appointment.patient;
        let msg = "";
        let notifType = "appointment_status_change";

        if (status === "confirmed") {
          msg = `Your appointment on ${dateStr} at ${timeSlotStr} has been confirmed.`;
          notifType = "appointment_confirmed";
        } else if (status === "completed") {
          msg = `Your appointment on ${dateStr} at ${timeSlotStr} is completed.`;
          notifType = "appointment_completed";
        } else {
          msg = `Your appointment on ${dateStr} at ${timeSlotStr} was cancelled. ${reason ? `Reason: ${reason}` : ""}`;
          notifType = "appointment_cancelled";
        }

        try {
          await createNotification(updateReq as any, {
            hospital: appointment.hospital,
            recipient: patientId,
            sender: updateReq.user!._id,
            type: notifType,
            message: msg,
            relatedId: appointment._id as any,
          });

          if (updateReq.io) {
            updateReq.io
              .to(`patient_${patientId}`)
              .emit("appointment:status_change", {
                appointmentId: id,
                status: status === "rejected" ? "cancelled" : status,
                reason,
              });
          }
        } catch (notifErr) {
          console.error("[Status Update] Notification error:", notifErr);
        }
      }

      const fullAppointment = await Appointment.findById(id).populate({
        path: "doctor",
        populate: { path: "user" },
      });

      if (
        fullAppointment &&
        fullAppointment.doctor &&
        (fullAppointment.doctor as any).user
      ) {
        const dateStr = new Date(appointment.date).toDateString();
        const timeSlotStr = `${appointment.startTime} - ${appointment.endTime}`;
        await createNotification(updateReq as any, {
          hospital: appointment.hospital,
          recipient: (fullAppointment.doctor as any).user._id,
          sender: updateReq.user!._id,
          type: "system_alert",
          message: `Appointment for ${(fullAppointment.patient as any)?.name || "Patient"} on ${dateStr} at ${timeSlotStr} is ${status}`,
          relatedId: appointment._id as any,
        });
        if (updateReq.io) {
          updateReq.io
            .to(`doctor_${(fullAppointment.doctor as any).user._id}`)
            .emit("appointment:update", {
              appointmentId: id,
              status: status === "rejected" ? "cancelled" : status,
            });
          // Force Dashboard Refresh
          updateReq.io
            .to(`doctor_${(fullAppointment.doctor as any).user._id}`)
            .emit("dashboard:update", {
              message: `Appointment status updated to ${status}`,
              appointmentId: id,
            });
        }
      }

      if (updateReq.io) {
        updateReq.io.emit("appointment_status_changed", {
          appointmentId: id,
          status: status === "rejected" ? "cancelled" : status,
          doctorName: (fullAppointment?.doctor as any)?.user?.name || "Doctor",
          hospitalId: (appointment.hospital as any)?._id,
        });

        // Also Notify helpdesk via hospital room
        const hospitalId =
          (appointment.hospital as any)?._id || (appointment.hospital as any);
        if (hospitalId) {
          const hospitalRoom = `hospital_${hospitalId}`;
          updateReq.io.to(hospitalRoom).emit("dashboard:update", {
            message: `Appointment status updated to ${status}`,
            appointmentId: id,
          });
        }

        const patientId =
          (appointment.patient as any)?._id || (appointment.patient as any);
        const targetRoom = `patient_${patientId}`;
        if (patientId && updateReq.io) {
          if (status === "confirmed") {
            updateReq.io.to(targetRoom).emit("appointment_confirmed", {
              appointmentId: id,
              message: `Your appointment on ${dateStr} at ${timeSlotStr} has been confirmed.`,
            });
          } else if (status === "rejected" || status === "cancelled") {
            updateReq.io.to(targetRoom).emit("appointment_cancelled", {
              appointmentId: id,
              message: `Your appointment on ${dateStr} at ${timeSlotStr} was cancelled. ${reason ? `Reason: ${reason}` : ""}`,
            });
          }
        }

        // 🚀 INVALIDATE CACHE: Ensure doctor dashboard updates in real-time
        if (fullAppointment?.doctor) {
          const doctorUserId =
            (fullAppointment.doctor as any)?.user?._id ||
            (fullAppointment.doctor as any)?.user;
          await invalidateDoctorCache(doctorUserId?.toString());
        }
      }

      res.json({ message: `Appointment ${status}`, appointment });
    } catch (err) {
      console.error("Update Status Error:", err);
      res.status(500).json({ message: "Server error" });
    }
  },
);

export const getAppointments = asyncHandler(
  async (req: Request, res: Response) => {
    const appsReq = req as unknown as AppointmentRequest;
    try {
      const { role, _id } = appsReq.user!;
      console.log(`[getAppointments] Request from User: ${_id}, Role: ${role}`);
      let query: any = {};

      // Pagination and Sorting params
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;
      const sortOrder: 1 | -1 = req.query.sort === "oldest" ? 1 : -1;
      const searchQuery = req.query.search as string;

      const userRole = role?.trim().toLowerCase();
      if (userRole === "patient") {
        query.patient = _id;
      } else if (userRole === "doctor") {
        // 🚀 PERFORMANCE FIX: Try to get doctor profile once and keep it
        const docProfile = await DoctorProfile.findOne({ user: _id })
          .select("_id hospital")
          .lean();
        if (docProfile) {
          console.log(
            `[getAppointments] Doctor: ${_id} -> Profile: ${docProfile._id}`,
          );
          query.doctor = docProfile._id;
        } else {
          console.warn(`[getAppointments] No DoctorProfile for user ${_id}`);
          query.doctor = new mongoose.Types.ObjectId();
        }
      } else if (userRole === "helpdesk" || userRole === "hospital-admin") {
        // Helpdesk/Admin sees all appointments in a single-hospital system or filtered by hospital
        const userHospital = (appsReq.user as any).hospital;
        console.log(
          `[getAppointments] Helpdesk/Admin Hospital: ${userHospital}`,
        );

        if (userHospital) {
          // Ensure ObjectId for aggregation
          query.hospital =
            typeof userHospital === "string"
              ? new mongoose.Types.ObjectId(userHospital)
              : userHospital;
        } else {
          console.log(
            "[getAppointments] WARNING: No hospital found on user object, falling back to all hospitals or first hospital.",
          );
          const targetHospitalId = (appsReq as any).user?.hospital;
          const hospital = await Hospital.findById(targetHospitalId);
          if (hospital) {
            console.log(
              `[getAppointments] Fallback to Hospital found in DB: ${hospital._id}`,
            );
            query.hospital = hospital._id;
          }
        }

        if (req.query.patientId) {
          console.log(
            `[getAppointments] Filtering by Patient ID: ${req.query.patientId}`,
          );
          if (mongoose.Types.ObjectId.isValid(req.query.patientId as string)) {
            query.patient = new mongoose.Types.ObjectId(
              req.query.patientId as string,
            );
          }
        }
      }

      if (searchQuery) {
        // Find patients matching the name or ID - EXPLICITLY UNSCOPED for global patient lookup
        let matchingPatients: any[] = [];
        try {
          const patientSearchQuery = {
            $or: [
              { name: { $regex: searchQuery, $options: "i" } },
              { mobile: { $regex: searchQuery, $options: "i" } },
              { email: { $regex: searchQuery, $options: "i" } },
            ],
          };

          // Try to use unscoped if available (via plugin), otherwise fallback to regular find
          const patientFind = Patient.find(patientSearchQuery);
          matchingPatients = await ((patientFind as any).unscoped ? (patientFind as any).unscoped().select("_id") : patientFind.select("_id"));
        } catch (e) {
          console.error("[getAppointments] Patient search error:", e);
          // Fallback if Patient search fails
          matchingPatients = [];
        }

        const patientIds = matchingPatients.map((p: any) => p._id);

        query.$or = [
          { mrn: { $regex: searchQuery, $options: "i" } },
          { patient: { $in: patientIds } },
          { "patientDetails.name": { $regex: searchQuery, $options: "i" } },
          { "patientDetails.mobile": { $regex: searchQuery, $options: "i" } },
          { reason: { $regex: searchQuery, $options: "i" } },
          { appointmentId: { $regex: searchQuery, $options: "i" } },
        ];
      }

      if (req.query.status) {
        query.status = { $regex: req.query.status as string, $options: "i" };
      }

      if (req.query.date) {
        const dateStr = req.query.date as string;
        const startDate = new Date(dateStr);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(dateStr);
        endDate.setHours(23, 59, 59, 999);
        query.date = { $gte: startDate, $lte: endDate };
        console.log(
          `[getAppointments] Date Filter: ${startDate.toISOString()} to ${endDate.toISOString()}`,
        );
      } else {
        // Default to today and future for doctor/patient if no date specified
        // to keep it "fresh" unless it's an admin looking for history
        if (userRole === "doctor" || userRole === "patient") {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          // query.date = { $gte: today }; // Still optional, let's keep it historcial for now as per previous request
        }
      }

      const typeFilter = (req.query.type as string) || "all";
      const isFilteringByType = typeFilter !== "all";

      let total = 0;
      let results: any[] = [];

      if (!isFilteringByType) {
        total = await Appointment.countDocuments(query);

        // 🚀 PERFORMANCE FIX: Use populate instead of aggregate for 10 docs
        // This is significantly faster and uses indexes better for these models
        const apps = await Appointment.find(query)
          .sort({ date: sortOrder, createdAt: sortOrder })
          .skip(skip)
          .limit(limit)
          .populate({
            path: "patient",
            select: "name mobile email",
          })
          .populate("hospital", "name")
          .populate({
            path: "doctor",
            populate: { path: "user", select: "name" },
          })
          .lean();

        results = apps;

        // Still need to check for IPD/OPD status for each if the UI uses it
        const patientIds = apps.map((a) => a.patient?._id || a.patient);
        const activeAdmissions = await IPDAdmission.find({
          patient: { $in: patientIds },
          status: "Active",
        })
          .select("patient")
          .lean();

        const activePatientIds = new Set(
          activeAdmissions.map((adm) => adm.patient.toString()),
        );

        results = apps.map((app: any) => ({
          ...app,
          patientType: (app.isIPD || app.type?.toUpperCase() === 'IPD')
            ? "IPD"
            : activePatientIds.has(
              app.patient?._id?.toString() || app.patient?.toString(),
            )
              ? "IPD"
              : "OPD",
        }));
      } else {
        // Complex type filtering still uses IPDAdmission lookup
        const hospitalId = query.hospital
          ? typeof query.hospital === "string"
            ? new mongoose.Types.ObjectId(query.hospital)
            : query.hospital
          : null;
        const ipdQuery: any = { status: "Active" };
        if (hospitalId) ipdQuery.hospital = hospitalId;

        const activeAdmissionPatientIds =
          await IPDAdmission.find(ipdQuery).distinct("patient");

        if (typeFilter === "IPD") {
          query.$or = [
            { type: "IPD" },
            { isIPD: true },
            { patient: { $in: activeAdmissionPatientIds } },
          ];
        } else if (typeFilter === "OPD") {
          query.$and = [
            { type: { $ne: "IPD" } },
            { isIPD: { $ne: true } },
            { patient: { $nin: activeAdmissionPatientIds } },
          ];
        }

        total = await Appointment.countDocuments(query);
        results = await Appointment.find(query)
          .sort({ date: sortOrder, createdAt: sortOrder })
          .skip(skip)
          .limit(limit)
          .populate({
            path: "patient",
            select: "name mobile email",
          })
          .populate("hospital", "name")
          .populate({
            path: "doctor",
            populate: { path: "user", select: "name" },
          })
          .lean();

        results = results.map((app) => ({
          ...app,
          patientType: (app.isIPD || app.type?.toUpperCase() === 'IPD')
            ? "IPD"
            : activeAdmissionPatientIds.some(id => id.toString() === (app.patient?._id?.toString() || app.patient?.toString()))
              ? "IPD"
              : "OPD",
        }));
      }

      const totalPages = Math.ceil(total / limit);

      // Map and format results efficiently
      const enrichedAppointments = results.map((app: any) => {
        const patientObj = app.patient;
        const doctorObj = app.doctor;
        const doctorUserObj = doctorObj?.user;

        return {
          ...app,
          id: app._id,
          timeSlot:
            app.startTime && app.endTime
              ? `${app.startTime} - ${app.endTime}`
              : app.appointmentTime || "N/A",
          patientName:
            app.patientDetails?.name || patientObj?.name || "Unknown",
          patient: {
            _id: app.patient?._id || app.patient,
            name: app.patientDetails?.name || patientObj?.name || "Unknown",
            mobile: patientObj?.mobile || app.patientDetails?.mobile || "N/A",
            email: patientObj?.email || "N/A",
            mrn: app.mrn || "N/A",
            age: app.patientDetails?.age || "N/A",
            gender: app.patientDetails?.gender || "N/A",
          },
          doctor: {
            _id: app.doctor?._id || app.doctor,
            name: doctorUserObj?.name || "N/A",
          },
          hospital: app.hospital?.name || "N/A",
          patientType: app.patientType || "OPD",
        };
      });

      (req as any).markStage?.("mapping-done");

      res.json({
        success: true,
        data: enrichedAppointments,
        pagination: {
          total,
          page,
          limit,
          totalPages,
        },
      });
    } catch (err: any) {
      console.error("[getAppointments] CRITICAL Error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Ensure we NEVER return an empty object {} even if JSON.stringify(err) would do that
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "Internal server error while fetching appointments",
          error: errorMsg,
          details:
            process.env.NODE_ENV === "development"
              ? err.stack || "No stack trace available"
              : undefined,
        });
      }
    }
  },
);

export const getAppointmentById = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const appointment = await Appointment.findById(id)
        .populate("patient", "name mobile email age gender")
        .populate({
          path: "doctor",
          populate: { path: "user", select: "name" },
        })
        .populate("hospital", "name address")
        .lean();

      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      // Normalize if needed, similar to getAppointments
      const app: any = appointment;
      app.timeSlot = `${app.startTime} - ${app.endTime}`;

      // Ensure we fetch PatientProfile for missing details like MRN/Age if they aren't on User
      if (app.patient) {
        try {
          const profile = await PatientProfile.findOne({
            user: (app.patient as any)._id,
          });

          if (profile) {
            console.log(
              `[BookingController] Found Profile. DOB: ${profile.dob}`,
            );

            // Manual age calculation to be fail-safe
            let derivedAge: number | null = null;
            if (profile.dob) {
              const diff = Date.now() - new Date(profile.dob).getTime();
              derivedAge = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
            }

            // Use Virtual if available, else Manual
            const finalAge = profile.age || derivedAge;

            if (finalAge) {
              app.patient.age = finalAge;
            }

            if (!app.patient.gender && profile.gender)
              app.patient.gender = profile.gender;
            if (!app.patient.mrn && profile.mrn) app.patient.mrn = profile.mrn;

            // Also ensure top-level MRN on appointment if missing
            if (!app.mrn && profile.mrn) app.mrn = profile.mrn;
          } else {
            console.log(
              `[BookingController] No PatientProfile found for user ${(app.patient as any)._id}`,
            );
          }
        } catch (pErr) {
          console.error("Error fetching patient profile in details:", pErr);
        }

        // Check if patientDetails overrides exist (Walk-in/Helpdesk specific)
        if (app.patientDetails && app.patientDetails.name)
          (app.patient as any).name = app.patientDetails.name;
        if (app.patientDetails && app.patientDetails.age)
          (app.patient as any).age = app.patientDetails.age;
        if (app.patientDetails && app.patientDetails.gender)
          (app.patient as any).gender = app.patientDetails.gender;
      }

      res.json(app);
    } catch (err: any) {
      console.error("Error fetching appointment details:", err);
      res.status(500).json({ message: "Server error", error: err.message });
    }
  },
);

export const getHospitalAppointmentStats = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const { date, range } = req.query;

      const targetHospitalId = (req as any).user?.hospital;
      const hospital = await Hospital.findById(targetHospitalId);
      if (!hospital)
        return res.status(404).json({ message: "Clinic settings not found" });
      const hospitalId = hospital._id;

      if (!date) {
        return res.status(400).json({ message: "Date is required" });
      }

      const selectedDate = new Date(date as string);

      if (range === "week") {
        const endDate = new Date(selectedDate);
        endDate.setHours(23, 59, 59, 999);

        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);

        const appointments = await Appointment.find({
          hospital: hospitalId,
          date: { $gte: startDate, $lte: endDate },
          status: { $ne: "cancelled" },
        })
          .populate("doctor", "name")
          .populate("patient", "name")
          .populate({
            path: "doctor",
            populate: { path: "user", select: "name" },
          })
          .lean();

        const dailyStatsMap: any = {};
        for (
          let d = new Date(startDate);
          d <= endDate;
          d.setDate(d.getDate() + 1)
        ) {
          const dateStr = d.toISOString().split("T")[0];
          dailyStatsMap[dateStr] = 0;
        }

        const doctorStatsMap: any = {};

        appointments.forEach((app: any) => {
          const appDate = new Date(app.date).toISOString().split("T")[0];
          if (dailyStatsMap[appDate] !== undefined) {
            dailyStatsMap[appDate]++;
          } else {
            dailyStatsMap[appDate] = 1;
          }

          const docName = (app.doctor as any)?.user?.name || "Unknown Doctor";
          doctorStatsMap[docName] = (doctorStatsMap[docName] || 0) + 1;
        });

        const dailyStats = Object.keys(dailyStatsMap)
          .sort()
          .map((dateStr) => ({
            date: dateStr,
            count: dailyStatsMap[dateStr],
          }));

        const topDoctors = Object.entries(doctorStatsMap)
          .map(([name, count]: any) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        return res.json({
          period: "week",
          totalPatients: appointments.length,
          dailyStats,
          topDoctors,
        });
      }

      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);

      const dailyAppointments = await Appointment.find({
        hospital: hospitalId,
        date: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
        status: { $ne: "cancelled" },
      })
        .populate("patient", "name mobile age gender")
        .populate({
          path: "doctor",
          populate: {
            path: "user",
            select: "name",
          },
        })
        .lean();

      const hourlyStats = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        count: 0,
        appointments: [],
      }));

      for (const app of dailyAppointments) {
        if (!app.startTime) continue;

        const [time, modifier] = app.startTime.split(" ");
        let [hours, minutes] = time.split(":").map(Number);

        if (modifier === "PM" && hours !== 12) hours += 12;
        if (modifier === "AM" && hours === 12) hours = 0;

        if (hours >= 0 && hours < 24) {
          (hourlyStats[hours] as any).count++;

          (hourlyStats[hours] as any).appointments.push({
            _id: app._id,
            patient: app.patient,
            patientDetails: app.patientDetails,
            doctorName: (app.doctor as any)?.user?.name || "Unknown Doctor",
            timeSlot: `${app.startTime} - ${app.endTime}`,
            reason: app.reason,
            urgency: app.urgency,
            status: app.status,
          });
        }
      }

      res.json(hourlyStats);
    } catch (err) {
      console.error("Error fetching hospital stats:", err);
      res.status(500).json({ message: "Server error" });
    }
  },
);
