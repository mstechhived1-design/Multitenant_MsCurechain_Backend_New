import { Request, Response } from "express";
// import HelpDesk from "../Models/HelpDesk.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";
import User from "../../Auth/Models/User.js";
import Patient from "../../Patient/Models/Patient.js";
import bcrypt from "bcrypt";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import PatientProfile from "../../Patient/Models/PatientProfile.js";
import mongoose from "mongoose";
import { HelpdeskRequest } from "../types/index.js";
import helpdeskService from "../../services/helpdesk.service.js";

// Authentication is now handled centrally via Auth/Controllers/authController.ts

export const helpdeskLogin = asyncHandler(
  async (req: Request, res: Response) => {
    const { mobile, password } = req.body;
    if (!mobile || !password)
      throw new ApiError(400, "mobile/loginId and password required");

    // Find helpdesk by mobile or loginId
    const helpdesk: any = await (User.findOne({
      role: "helpdesk",
      $or: [{ mobile: mobile }, { loginId: mobile }],
    }) as any).unscoped();

    if (!helpdesk) {
      throw new ApiError(401, "Invalid login credentials");
    }

    const match = await bcrypt.compare(password, helpdesk.password);
    if (!match) {
      throw new ApiError(401, "Password is wrong");
    }

    const { accessToken, csrfToken } = await (import("../../Auth/Controllers/authController.js")).then(m => m.handleAuthResponse(res, helpdesk, req));

    res.json({
      accessToken,
      csrfToken,
      user: { id: helpdesk._id, name: helpdesk.name, role: "helpdesk" },
    });
  },
);

// Refresh is now handled centrally via Auth/Controllers/authController.ts

export const helpdeskLogout = asyncHandler(
  async (req: Request, res: Response) => {
    const { tokenService } = await import("../../Auth/Services/tokenService.js");
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      try {
        const payload = tokenService.verifyRefreshToken(refreshToken);
        const hashedToken = tokenService.hashToken(refreshToken);

        await (User.updateOne(
          { _id: payload._id },
          { $pull: { refreshTokens: { tokenHash: hashedToken } } }
        ) as any).unscoped();
      } catch (e) { }
    }

    tokenService.clearCookies(res);
    res.status(204).send();
  },
);

export const helpdeskMe = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    if (!req.user) throw new ApiError(401, "Not authenticated as helpdesk");
    const hd = await User.findOne({
      _id: (req.user as any)._id,
      role: "helpdesk",
    }).populate("hospital", "name _id rooms departments");
    if (!hd) throw new ApiError(404, "Helpdesk not found");
    res.json({
      id: hd._id,
      name: hd.name,
      email: hd.email,
      mobile: hd.mobile,
      hospital: hd.hospital,
    });
  },
);

export const updateHelpdeskProfile = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    if (!req.user) throw new ApiError(401, "Not authenticated as helpdesk");
    const helpdesk = await User.findOne({
      _id: (req.user as any)._id,
      role: "helpdesk",
    });
    if (!helpdesk) throw new ApiError(404, "HelpDesk not found");

    const { name, email, mobile } = req.body;
    if (name) helpdesk.name = name;
    if (email) helpdesk.email = email;
    if (mobile) helpdesk.mobile = mobile;

    try {
      await helpdesk.save();
      res.json({
        id: helpdesk._id,
        name: helpdesk.name,
        email: helpdesk.email,
        mobile: helpdesk.mobile,
      });
    } catch (err: any) {
      if (err.code === 11000) {
        if (err.keyPattern && err.keyPattern.mobile) {
          throw new ApiError(
            400,
            "This phone number is already registered with another user. Please select another phone number.",
          );
        }
        throw new ApiError(400, "Duplicate field value entered");
      }
      throw err;
    }
  },
);

export const helpDeskDashboard = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const hospitalId = (req.user as any).hospital;

    if (!hospitalId) {
      const fallbackHospital = await Hospital.findOne();
      if (!fallbackHospital)
        throw new ApiError(400, "Hospital context required");
      (req.user as any).hospital = fallbackHospital._id;
    }
    const finalHospitalId = (req.user as any).hospital;

    // Date range for today's appointments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Run patient total count and other stats in parallel
    const [
      stats,
      totalPatientsInHospital,
      todayAppointments,
      recentPatientsProfiles,
    ] = await Promise.all([
      helpdeskService.getDashboardStats(finalHospitalId.toString()),
      Patient.countDocuments({ hospitals: finalHospitalId }),
      Appointment.find({
        hospital: finalHospitalId, // ✅ CRITICAL FIX: Explicitly scope to hospital
        $or: [
          { date: { $gte: today, $lt: tomorrow } },
          {
            status: {
              $in: [
                "pending",
                "confirmed",
                "in-progress",
                "Booked",
                "waiting",
                "scheduled",
              ],
            },
          },
        ],
        status: { $ne: "cancelled" },
      })
        .populate({
          path: "patient",
          select: "name mobile email",
          model: "Patient",
        })
        .populate({
          path: "doctor",
          populate: { path: "user", select: "name" },
        })
        .sort({ createdAt: 1 })
        .limit(20)
        .lean(),
      Patient.find({ hospitals: hospitalId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("name mobile email createdAt")
        .lean(),
    ]);

    // ... logic remains same but use the parallel results
    const patientIds = todayAppointments
      .map((apt: any) => apt.patient?._id)
      .filter((id) => id);
    const patientProfiles = await PatientProfile.find({
      user: { $in: patientIds },
    }).lean();
    const profileMap = new Map(
      (patientProfiles as any[]).map((p) => [p.user.toString(), p]),
    );

    const appointmentsWithNames = todayAppointments.map((apt: any) => {
      const profile: any = apt.patient?._id
        ? profileMap.get(apt.patient._id.toString())
        : null;
      let displayType = "OPD";
      if (apt.type === "IPD" || apt.visitType === "IPD" || apt.isIPD)
        displayType = "IPD";
      else if (apt.type === "emergency" || apt.urgency?.includes("Emergency"))
        displayType = "EMERGENCY";

      return {
        id: apt._id,
        patientId: apt.patient?._id,
        patientName: apt.patient?.name || "Unknown",
        mrn: profile?.mrn || apt.mrn || "N/A",
        doctorId: apt.doctor?._id || (apt.doctor as any)?.user?._id,
        doctorName: apt.doctor?.user?.name || "Unassigned",
        time: apt.appointmentTime || apt.startTime || "N/A",
        status: apt.status,
        type: displayType,
        date: apt.date,
      };
    });

    res.json({
      stats: {
        totalDoctors: stats.totalDoctors,
        totalHelpdesks: stats.totalHelpdesks,
        totalPatients: totalPatientsInHospital,
        todayPatients: stats.totalPatientsRegistered,
        pendingAppointments: stats.activeTransits,
        activeTransits: stats.activeTransits,
        emergencyCases: stats.pendingEmergencyRequests,
      },
      recentPatients: recentPatientsProfiles.map((p: any) => ({
        id: p._id,
        name: p.name,
        contact: p.mobile || p.email,
        registeredAt: p.createdAt,
      })),
      appointments: appointmentsWithNames,
    });
  },
);

/* 
export const helpdeskCreateDoctor = async (req: HelpdeskRequest, res: Response) => {
    // Restricting to hospital-admin and super-admin. Use Admin/Controllers/adminController.ts instead.
    return res.status(403).json({ message: "Helpdesk not authorized to create doctors" });
};
*/

export const getHelpDeskById = asyncHandler(
  async (req: Request, res: Response) => {
    const helpdesk = await User.findOne({
      _id: req.params.id,
      role: "helpdesk",
    })
      .select("-password")
      .populate({
        path: "assignedStaff",
        populate: { path: "user", select: "name email mobile" },
      });
    if (!helpdesk) throw new ApiError(404, "HelpDesk not found");

    console.log("[HELPDESK GET] Returning helpdesk:", {
      id: helpdesk._id,
      name: helpdesk.name,
      loginId: (helpdesk as any).loginId,
      assignedStaff: (helpdesk as any).assignedStaff,
      hasAssignedStaff: !!(helpdesk as any).assignedStaff,
    });

    res.json(helpdesk);
  },
);

export const getHelpDeskDoctors = asyncHandler(
  async (req: HelpdeskRequest, res: Response) => {
    const hospitalId = req.user?.hospital;
    if (!hospitalId) {
      return res
        .status(400)
        .json({ message: "Hospital not assigned to helpdesk" });
    }

    const doctors = await DoctorProfile.find({ hospital: hospitalId })
      .populate("user", "name email mobile avatar")
      .select(
        "specialties qualifications experienceStart experienceYears consultationFee bio availability hospital employeeId",
      )
      .lean();

    res.json(doctors);
  },
);

export const getHelpDeskByHospitalId = asyncHandler(
  async (req: Request, res: Response) => {
    const { hospitalId } = req.params;
    const helpdesk = await User.findOne({
      hospital: hospitalId,
      role: "helpdesk",
    }).select("-password");
    if (!helpdesk)
      throw new ApiError(404, "HelpDesk not found for this hospital");
    res.json(helpdesk);
  },
);
