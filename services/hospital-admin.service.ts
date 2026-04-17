// Hospital Admin Service Layer
// Features: Business logic separation, query optimization, caching strategies

import User from "../Auth/Models/User.js";
import SuperAdmin from "../Auth/Models/SuperAdmin.js";
import Patient from "../Patient/Models/Patient.js";
import PatientProfile from "../Patient/Models/PatientProfile.js";
import DoctorProfile from "../Doctor/Models/DoctorProfile.js";
import StaffProfile from "../Staff/Models/StaffProfile.js";
// import HelpDeskProfile from "../Helpdesk/Models/HelpDesk.js";
import Hospital from "../Hospital/Models/Hospital.js";
import Attendance from "../Staff/Models/Attendance.js";
import Shift from "../Staff/Models/Shift.js";
import Appointment from "../Appointment/Models/Appointment.js";
import Leave from "../Leave/Models/Leave.js";
import Transaction from "../Admin/Models/Transaction.js";
import Payroll from "../Staff/Models/Payroll.js";
import PharmaInvoice from "../Pharmacy/Models/Invoice.js";
import IPDMedicineIssuance from "../Pharmacy/Models/IPDMedicineIssuance.js";
import LabOrder from "../Lab/Models/LabOrder.js";
import IPDAdmission from "../IPD/Models/IPDAdmission.js";
import Bed from "../IPD/Models/Bed.js";
import Room from "../IPD/Models/Room.js";
import Department from "../IPD/Models/IPDDepartment.js";
import DischargeRecord from "../Discharge/Models/DischargeRecord.js";
import redisService from "../config/redis.js";
import mongoose from "mongoose";
import { IPayroll } from "../Staff/types/index.js";
// FIX: Import decryptObject for manual decryption after .lean() queries where needed
import { decryptObject } from "../utils/crypto.js";

export interface DashboardStats {
  totalDoctors: number;
  totalStaff: number;
  totalNurses: number;
  totalPatients: number;
  activeAppointments: number;
  todayAttendance: number;
  pendingLeaves: number;
  monthlyRevenue: number;
  labRevenue: number;
  pharmaRevenue: number;
  totalLabRequests: number;
  totalPharmaSales: number;
  totalInpatients: number;
  totalAdmissions: number;
  opdRevenue: number;
  ipdRevenue: number;
  opdCompleted: number;
  opdPending: number;
  ipdActive: number;
  ipdDischarged: number;
  totalHR: number;
  totalHelpdesk: number;
  bedOccupancy: number;
  avgPatientWaitTime: number; // in minutes
  avgConsultationTime: number; // in minutes
  inactiveCount: number; // Total number of suspended/inactive personnel nodes
  timestamp: string;
}

export class HospitalAdminService {
  /**
   * Get optimized dashboard stats with caching
   */
  async getDashboardStats(
    hospitalId: string,
    filters?: {
      range?: string;
      startDate?: string;
      endDate?: string;
      visitType?: string;
    },
    useCache: boolean = true,
  ): Promise<DashboardStats> {
    const range = filters?.range || "today";
    const visitType = filters?.visitType || "all";
    const cacheKey = `dashboard:stats:${hospitalId}:${range}:${filters?.startDate || ""}:${filters?.endDate || ""}:${visitType}`;

    // Try cache first (Bypassed for live data reconciliation)
    // if (useCache) {
    //   const cached = await redisService.get<DashboardStats>(cacheKey);
    //   if (cached && (cached as any).totalDoctors !== undefined)
    //     return cached as DashboardStats;
    // }

    // Date range calculation
    let start = new Date();
    let end = new Date();
    const now = new Date();

    if (range === "today") {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (range === "7days") {
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
    } else if (range === "month") {
      start.setMonth(now.getMonth() - 1);
      start.setHours(0, 0, 0, 0);
    } else if (range === "3months") {
      start.setMonth(now.getMonth() - 3);
      start.setHours(0, 0, 0, 0);
    } else if (range === "custom" && filters?.startDate && filters?.endDate) {
      start = new Date(filters.startDate);
      end = new Date(filters.endDate);
    } else {
      // Default to today
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    }

    // Parallel queries for better performance
    const activeQuery: any = hospitalId
      ? { hospital: hospitalId, status: "active" }
      : { status: "active" };

    const inactiveQuery: any = hospitalId
      ? { hospital: hospitalId, status: { $in: ["inactive", "suspended"] } }
      : { status: { $in: ["inactive", "suspended"] } };

    // Stats that are generally "total in period"
    const periodQuery: any = hospitalId ? { hospital: hospitalId } : {};
    const patientQuery: any = hospitalId ? { hospitals: hospitalId } : {};
    const dateQuery = { createdAt: { $gte: start, $lte: end } };

    // visitType-specific query adjustments
    const typeFilter: any = {};
    if (visitType === "opd") {
      typeFilter.type = { $ne: "IPD" };
      dateQuery["admission"] = { $exists: false }; // For Lab/Pharma
    } else if (visitType === "ipd") {
      typeFilter.type = "IPD";
      // admissions is IPD only by nature
    }

    const [
      totalDoctors,
      totalNurses,
      totalStaff,
      totalHR,
      totalHelpdesk,
      totalPatients,
      activeAppointments,
      todayAttendance,
      pendingLeaves,
      opdRevenue,
      totalLabRequests,
      labRevenue,
      totalPharmaSales,
      pharmaRevenue,
      totalInpatients,
      totalAdmissions,
      ipdRevenue,
      bedStats,
      avgWait,
      avgConsult,
      inactiveCount,
      opdCompleted,
      opdPending,
      ipdDischargedToday,
    ] = await Promise.all([
      (
        User.countDocuments({ ...activeQuery, role: "doctor" }) as any
      ).unscoped(),
      (
        User.countDocuments({ ...activeQuery, role: "nurse" }) as any
      ).unscoped(),
      (
        User.countDocuments({ ...activeQuery, role: "staff" }) as any
      ).unscoped(),
      (User.countDocuments({ ...activeQuery, role: "hr" }) as any).unscoped(),
      (
        User.countDocuments({ ...periodQuery, role: "helpdesk" }) as any
      ).unscoped(),
      (Patient.countDocuments(patientQuery) as any).unscoped(),
      this.getPeriodAppointmentsCount(hospitalId, start, end, "opd"),
      this.getTodayAttendanceCount(hospitalId),
      this.getPendingLeavesCount(hospitalId),
      this.getPeriodRevenue(hospitalId, start, end, "opd"), // Always OPD for this card
      this.getLabOrderCount(hospitalId, start, end, visitType),
      this.getLabRevenue(hospitalId, start, end, visitType),
      this.getPharmaInvoiceCount(hospitalId, start, end, visitType),
      this.getPharmaRevenue(hospitalId, start, end, visitType),
      (
        IPDAdmission.countDocuments({
          hospital: {
            $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)],
          },
          status: "Active",
        }) as any
      ).unscoped(),
      (
        IPDAdmission.countDocuments({
          hospital: {
            $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)],
          },
          ...periodQuery,
          ...dateQuery,
        }) as any
      ).unscoped(),
      this.getIPDRevenue(hospitalId, start, end, "ipd"),
      this.getBedOccupancy(hospitalId),
      this.getAvgPatientWaitTime(hospitalId, start, end, visitType),
      this.getAvgConsultationTime(hospitalId, start, end, visitType),
      (User.countDocuments(inactiveQuery) as any).unscoped(),
      this.getAppointmentCountByStatus(hospitalId, start, end, "completed"),
      this.getAppointmentCountByStatus(hospitalId, start, end, [
        "pending",
        "confirmed",
        "Booked",
      ]),
      this.getIPDDischargeCount(hospitalId, start, end),
    ]);

    // Handle visitType exclusion for Admissions/Inpatients
    // These specific variables should always be calculated for their respective cards
    const opdRevenueVal = opdRevenue;
    const ipdRevenueVal = ipdRevenue;

    const totalRevenue =
      visitType === "ipd"
        ? ipdRevenue + labRevenue + pharmaRevenue
        : visitType === "opd"
          ? opdRevenue + labRevenue + pharmaRevenue
          : opdRevenue + labRevenue + pharmaRevenue + ipdRevenue;

    const stats = {
      totalDoctors,
      totalNurses,
      totalStaff,
      totalHR,
      totalHelpdesk,
      totalPatients,
      activeAppointments,
      todayAttendance,
      pendingLeaves,
      monthlyRevenue: Math.round(totalRevenue),
      opdRevenue: Math.round(opdRevenueVal),
      ipdRevenue: Math.round(ipdRevenueVal),
      opdCompleted,
      opdPending,
      ipdActive: totalInpatients,
      ipdDischarged: ipdDischargedToday,
      labRevenue: Math.round(labRevenue),
      pharmaRevenue: Math.round(pharmaRevenue),
      totalLabRequests,
      totalPharmaSales,
      totalInpatients,
      totalAdmissions,
      bedOccupancy: visitType === "opd" ? 0 : bedStats,
      avgPatientWaitTime: avgWait,
      avgConsultationTime: avgConsult,
      inactiveCount,
      timestamp: new Date().toISOString(),
    };

    // Cache for 30 seconds (Balanced for performance vs freshness)
    await redisService.set(cacheKey, stats, 30);

    return stats;
  }

  /**
   * Get all users with optimized pagination and filtering
   */
  async getAllUsers(
    hospitalId: string,
    role?: string,
    page: number = 1,
    limit: number = 20,
    search?: string,
    sortBy: string = "createdAt",
    sortOrder: "asc" | "desc" = "desc",
  ) {
    const query: any = {};
    if (hospitalId) {
      query.hospital = hospitalId;
    }

    if (role) query.role = role;

    // Text search on name, email, mobile
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
      ];
    }

    // DEBUG: Log query parameters removed

    const skip = (page - 1) * limit;
    const sort: any = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    // Handle SuperAdmin separately
    if (role === "super-admin") {
      const skip = (page - 1) * limit;
      const [admins, total] = await Promise.all([
        SuperAdmin.find(
          search
            ? {
                ...query,
                $or: [
                  { name: { $regex: search, $options: "i" } },
                  { email: { $regex: search, $options: "i" } },
                ],
              }
            : query,
        )
          .select("-password -refreshTokens")
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
        SuperAdmin.countDocuments(query),
      ]);

      return {
        users: admins,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    }

    // Handle Patient separately
    if (role === "patient") {
      const skip = (page - 1) * limit;
      const patientQuery = { ...query };
      if (hospitalId) {
        delete patientQuery.hospital;
        patientQuery.hospitals = hospitalId;
      }

      const [patients, total] = await Promise.all([
        Patient.find(
          search
            ? {
                ...patientQuery,
                $or: [
                  { name: { $regex: search, $options: "i" } },
                  { mobile: { $regex: search, $options: "i" } },
                  { email: { $regex: search, $options: "i" } },
                ],
              }
            : patientQuery,
        )
          .select("-password -refreshTokens")
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
        Patient.countDocuments(patientQuery),
      ]);

      const patientIds = patients.map((p) => p._id);
      
      const patientProfileQuery: any = { user: { $in: patientIds } };
      const appointmentQuery: any = { patient: { $in: patientIds } };
      
      if (hospitalId) {
        patientProfileQuery.hospital = hospitalId;
        appointmentQuery.hospital = hospitalId;
      }
      
      const [profiles, appointments] = await Promise.all([
        PatientProfile.find(patientProfileQuery).lean().exec(),
        Appointment.find(appointmentQuery)
          .sort({ date: -1, createdAt: -1 })
          .select('patient vitals')
          .lean()
          .exec()
      ]);
      
      const enrichedPatients = patients.map((patient) => {
        const profile = profiles.find((p) => p.user?.toString() === patient._id.toString());
        
        // Find the absolute latest appointment that actually has vitals logged
        const latestAppointment = appointments.find(
          (a) => a.patient?.toString() === patient._id.toString() && a.vitals && Object.keys(a.vitals).length > 0
        );
        
        return {
          ...patient,
          ...profile,
          profile,
          _id: patient._id, // Ensure patient _id is respected, not profile _id
          patientProfileId: profile?._id,
          latestVitals: latestAppointment?.vitals || null
        };
      });

      return {
        users: enrichedPatients,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    }

    // Handle Helpdesk
    if (role === "helpdesk") {
      const [helpdesks, total] = await Promise.all([
        (User.find(query) as any)
          .unscoped()
          .populate("hospital", "name city hospitalId")
          .populate({
            path: "assignedStaff",
            populate: { path: "user", select: "name email mobile" },
          })
          .select("-password -refreshTokens")
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
        (User.countDocuments(query) as any).unscoped().exec(),
      ]);

      return {
        users: helpdesks, // Return as users for compatibility
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    }

    // Handle Staff/Nurse/Emergency with Profiling
    if (["staff", "nurse", "emergency"].includes(role as string)) {
      const [users, total] = await Promise.all([
        (User.find(query) as any)
          .unscoped()
          .populate("hospital", "name city hospitalId")
          .select("-password -refreshTokens -__v")
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
        (User.countDocuments(query) as any).unscoped().exec(),
      ]);

      // Populate Profiles
      const userIds = users.map((u) => u._id);
      const profiles = await StaffProfile.find({
        user: { $in: userIds },
      }).lean();

      const enrichedUsers = users.map((user) => {
        const profile = profiles.find(
          (p) => p.user?.toString() === user._id.toString(),
        );
        return {
          ...user,
          ...profile,
          _id: user._id, // Ensure user ID is the main ID
          staffProfileId: profile?._id,
        };
      });

      return {
        users: enrichedUsers,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    }

    // Handle Doctor with Profiling (Fix for missing consultationFee)
    if (role === "doctor") {
      const [users, total] = await Promise.all([
        (User.find(query) as any)
          .unscoped()
          .populate("hospital", "name city hospitalId")
          .select("-password -refreshTokens -__v")
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
        (User.countDocuments(query) as any).unscoped().exec(),
      ]);

      // Populate Profiles
      const userIds = users.map((u) => u._id);
      const profiles = await DoctorProfile.find({
        user: { $in: userIds },
      }).lean();

      const enrichedUsers = users.map((user) => {
        const profile = profiles.find(
          (p) => p.user?.toString() === user._id.toString(),
        );
        return {
          ...user,
          ...profile,
          _id: user._id, // Ensure user ID is the main ID
          doctorProfileId: profile?._id,
          consultationFee: profile?.consultationFee || 0,
        };
      });

      return {
        users: enrichedUsers,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    }

    // Default User Fetching (for Doctors, Patients, etc. - Doctors have their own detail route)
    const [users, total] = await Promise.all([
      (User.find(query) as any)
        .unscoped()
        .populate("hospital", "name city hospitalId")
        .select("-password -__v")
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      (User.countDocuments(query) as any).unscoped().exec(),
    ]);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get user with profile (optimized with populate)
   */
  async getUserWithProfile(userId: string, role: string) {
    const cacheKey = `user:profile:${userId}`;

    // Try cache
    const cached = await redisService.get(cacheKey);
    if (cached) return cached;

    let user;

    switch (role) {
      case "doctor":
        user = await (User.findById(userId) as any)
          .unscoped()
          .populate("hospital", "name address")
          .lean()
          .exec();
        const doctorProfile = await (
          DoctorProfile.findOne({
            user: userId,
          }) as any
        )
          .unscoped()
          .lean()
          .exec();
        user = { ...user, profile: doctorProfile };
        break;

      case "staff":
      case "nurse":
      case "emergency":
        user = await (User.findById(userId) as any)
          .unscoped()
          .populate("hospital", "name address")
          .lean()
          .exec();
        const staffProfile = await (
          StaffProfile.findOne({
            user: userId,
          }) as any
        )
          .unscoped()
          .lean()
          .exec();
        user = { ...user, profile: staffProfile };
        break;

      case "helpdesk":
        user = await (User.findById(userId) as any)
          .unscoped()
          .populate("hospital", "name address")
          .populate({
            path: "assignedStaff",
            populate: { path: "user", select: "name email mobile" },
          })
          .lean()
          .exec();
        break;

      default:
        user = await (User.findById(userId) as any)
          .unscoped()
          .populate("hospital", "name address")
          .select("-password")
          .lean()
          .exec();
    }

    // Cache for 15 seconds
    await redisService.set(cacheKey, user, 15);

    return user;
  }

  /**
   * Get doctors with advanced filtering
   */
  async getDoctors(
    hospitalId: string,
    filters?: {
      specialties?: string[];
      status?: string;
      availability?: boolean;
    },
    page: number = 1,
    limit: number = 20,
  ) {
    const query: any = { hospital: hospitalId };

    if (filters?.status) query.status = filters.status;

    const skip = (page - 1) * limit;

    // Get doctors with profiles in one aggregation
    const doctors = await User.aggregate([
      { $match: { ...query, role: "doctor" } },
      {
        $lookup: {
          from: "doctorprofiles",
          localField: "_id",
          foreignField: "user",
          as: "profile",
        },
      },
      { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
      {
        $match: filters?.specialties
          ? { "profile.specialties": { $in: filters.specialties } }
          : {},
      },
      {
        $project: {
          password: 0,
          __v: 0,
        },
      },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);

    const total = await (
      User.countDocuments({ ...query, role: "doctor" }) as any
    )
      .unscoped()
      .exec();

    return {
      doctors,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get attendance report with aggregation
   */
  async getAttendanceReport(
    hospitalId: string,
    startDate: Date,
    endDate: Date,
    department?: string,
  ) {
    const cacheKey = `attendance:report:${hospitalId}:${startDate.toISOString()}:${endDate.toISOString()}:${department || "all"}`;

    // Try cache
    const cached = await redisService.get(cacheKey);
    if (cached) return cached;

    const matchStage: any = {
      hospital: new mongoose.Types.ObjectId(hospitalId),
      date: { $gte: startDate, $lte: endDate },
    };

    const report = await Attendance.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: "$userDetails" },
      {
        $group: {
          _id: "$user",
          fullName: { $first: "$userDetails.name" },
          role: { $first: "$userDetails.role" },
          totalDays: { $sum: 1 },
          presentDays: {
            $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] },
          },
          absentDays: {
            $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] },
          },
          lateDays: {
            $sum: { $cond: [{ $eq: ["$isLate", true] }, 1, 0] },
          },
          avgCheckInTime: { $avg: { $hour: "$checkInTime" } },
        },
      },
      { $sort: { presentDays: -1 } },
    ]);

    // Cache for 10 seconds
    await redisService.set(cacheKey, report, 10);

    return report;
  }

  /**
   * Get shift management data
   */
  async getShifts(hospitalId: string) {
    const cacheKey = `shifts:${hospitalId}`;

    const cached = await redisService.get(cacheKey);
    if (cached) return cached;

    const shifts = await Shift.find({ hospital: hospitalId })
      .populate("assignedStaff", "name email role")
      .lean();

    await redisService.set(cacheKey, shifts, 15);

    return shifts;
  }

  /**
   * Get transactions with pagination
   */
  async getTransactions(
    hospitalId: string,
    filters?: {
      type?: string;
      allowedTypes?: string[];
      status?: string;
      startDate?: Date;
      endDate?: Date;
      patientId?: string;
    },
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;
    const hospitalObjId = new mongoose.Types.ObjectId(hospitalId);
    const patientObjId = filters?.patientId
      ? new mongoose.Types.ObjectId(filters.patientId)
      : null;

    // 🔧 Filter Mapping
    const requestedTypes = filters?.type
      ? filters.type.split(",")
      : filters?.allowedTypes || [];

    // 🔧 Category Mapping for Filter Accuracy
    const typeMapping: Record<string, any> = {
      ipd: {
        $in: [
          "ipd_advance",
          "ipd_admission_fee",
          "ipd_bill_payment",
          "ipd_final_settlement",
        ],
      },
      opd: { $in: ["appointment_booking", "opd", "consultation"] },
      discharge: "ipd_final_settlement",
    };

    const requestedTypeStr = String(filters?.type || "").toLowerCase();

    // 🛡️ DEFAULT BEHAVIOR: Default to OPD if no specific type is provided
    const isDefault =
      !filters?.type &&
      (!filters?.allowedTypes || filters.allowedTypes.length === 0);
    const showAll = requestedTypeStr === "all";

    const isIpdAll = requestedTypes.includes("ipd");
    const isIpdAdvanceOnly =
      requestedTypes.includes("ipd_advance") ||
      requestedTypes.includes("ipd_refund");
    const isDischargeOnly =
      requestedTypes.includes("ipd_final_settlement") ||
      requestedTypes.includes("discharge");
    const isOpdAll =
      isDefault ||
      requestedTypes.includes("opd") ||
      requestedTypes.includes("appointment_booking") ||
      requestedTypes.includes("consultation");

    console.log(`🔍 [Transactions] Fetching for hospital: ${hospitalId}`);
    console.log(
      `📊 [Filters] Type: ${filters?.type}, Status: ${filters?.status}, ShowAll: ${showAll}, isIpdAll: ${isIpdAll}, isOpdAll: ${isOpdAll}`,
    );

    // 🛡️ Base match query (Hardened hospital isolation using ObjectId)
    const baseMatch: any = { hospital: hospitalObjId };

    if (
      filters?.startDate ||
      filters?.endDate ||
      filters?.status ||
      filters?.patientId
    ) {
      baseMatch.$and = [];
    }

    if (filters?.startDate || filters?.endDate) {
      const dateQuery: any = {};
      if (filters.startDate) dateQuery.$gte = new Date(filters.startDate);
      if (filters.endDate) dateQuery.$lte = new Date(filters.endDate);
      baseMatch.$and.push({ date: dateQuery });
    }

    if (filters?.status) baseMatch.$and.push({ status: filters.status });
    if (filters?.patientId) baseMatch.$and.push({ user: patientObjId });

    const pipeline: any[] = [
      {
        $match: {
          ...baseMatch,
          // Hide specialized records from generic ledger to avoid double-counting
          // Records in generic 'transactions' collection with these types are suppressed
          // because they are unioned from their respective source-of-truth collections.
          type: {
            $nin: [
              "ipd_advance",
              "ipd_final_settlement",
              "appointment_booking",
              "discharge",
            ],
          },
        },
      },
      { $addFields: { priority: 0 } },
    ];

    // 🔄 STAGE 1: IPD Advance Payments (Source: ipdadvancepayments)
    if (showAll || isIpdAll || isIpdAdvanceOnly || isDischargeOnly) {
      pipeline.push({
        $unionWith: {
          coll: "ipdadvancepayments",
          pipeline: [
            {
              $match: {
                hospital: hospitalObjId,
                transactionType: { $ne: "Refund" },
              },
            },
            // 🛡️ DEDUPLICATION: Check if a corresponding record already exists in the primary Transactions collection
            // We match by referenceId (admission) and use a lookup to see if we should skip this installment
            {
              $lookup: {
                from: "ipdadmissions",
                localField: "admission",
                foreignField: "_id",
                as: "adm",
              },
            },
            { $unwind: { path: "$adm", preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: "users",
                localField: "patient",
                foreignField: "_id",
                as: "pUser",
              },
            },
            { $unwind: { path: "$pUser", preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 1,
                user: "$patient",
                hospital: 1,
                amount: "$amount",
                transactionId: { $ifNull: ["$transactionId", "$receiptNumber", "$admissionId", "—"] },
                receiptNumber: { $ifNull: ["$receiptNumber", "$transactionId", "—"] },
                patientName: {
                  $ifNull: [
                    "$adm.patientName",
                    "$pUser.name",
                    "Unknown Patient",
                  ],
                },
                phone: { $ifNull: ["$adm.phone", "$pUser.mobile"] },
                type: {
                  $cond: {
                    if: { $eq: ["$transactionType", "Settlement"] },
                    then: "ipd_bill_payment",
                    else: "ipd_advance",
                  },
                },
                status: { $literal: "completed" },
                referenceId: "$_id",
                date: "$date",
                paymentMode: { $toLower: { $ifNull: ["$mode", "cash"] } },
                reason: { $ifNull: ["$adm.reason", "IPD Advance"] },
                primaryDoctor: "$adm.primaryDoctor",
                admissionId: "$adm.admissionId",
                totalBillAmount: { $ifNull: ["$adm.totalBilledAmount", 0] },
                dueAmount: { $ifNull: ["$adm.balanceDue", 0] },
                disease: "$adm.disease",
                diagnosis: "$adm.diagnosis",
                priority: { $literal: 1 },
              },
            },
          ],
        },
      });
    }

    // 🔄 STAGE 2: Discharge settlements
    if (showAll || isIpdAll || isDischargeOnly) {
      pipeline.push({
        $unionWith: {
          coll: "dischargerecords",
          pipeline: [
            {
              $match: {
                hospital: hospitalObjId,
                status: "completed",
              },
            },
            // Lookup parent admission to recover missing doctor names
            {
              $lookup: {
                from: "ipdadmissions",
                localField: "admissionId",
                foreignField: "admissionId",
                as: "admChild",
              },
            },
            {
              $unwind: { path: "$admChild", preserveNullAndEmptyArrays: true },
            },
            {
              $project: {
                _id: 1,
                user: "$patient",
                hospital: 1,
                amount: { $ifNull: ["$finalPayment", "$balance", 0] }, // DUE AMOUNT
                totalBillAmount: { $ifNull: ["$totalBillAmount", 0] },
                advanceAmount: { $ifNull: ["$advanceAmount", 0] },
                type: { $literal: "ipd_final_settlement" },
                status: { $literal: "completed" },
                referenceId: "$_id",
                admissionId: "$admissionId",
                date: { $ifNull: ["$paymentSettledAt", "$updatedAt"] },
                paymentMode: {
                  $toLower: { $ifNull: ["$paymentMode", "cash"] },
                },
                reason: {
                  $ifNull: [
                    "$reasonForAdmission",
                    "$admChild.reason",
                    "IPD Discharge",
                  ],
                },
                primaryDoctor: {
                  $ifNull: ["$primaryDoctor", "$admChild.primaryDoctor"],
                },
                patientName: "$patientName",
                phone: "$phone",
                disease: "$disease",
                diagnosis: "$diagnosis",
                conditionAtDischarge: "$conditionAtDischarge",
                priority: { $literal: 1 },
                transactionId: { $ifNull: ["$transactionId", "$documentId", "$admissionId", "—"] },
                receiptNumber: { $ifNull: ["$receiptNumber", "$documentId", "—"] },
              },
            },
          ],
        },
      });
    }

    // 🔄 STAGE 3: Appointments (OPD)
    if (showAll || isOpdAll) {
      console.log(`🔌 [Stage 3] Activating OPD Appointment Union Stream...`);
      pipeline.push({
        $unionWith: {
          coll: "appointments",
          pipeline: [
            {
              $match: {
                hospital: hospitalObjId,
                isIPD: { $ne: true }, // 🛡️ EXCLUDE IPD APPOINTMENTS FROM OPD STREAM
                status: { $nin: ["cancelled", "Cancelled", "canceled", "Canceled", "CANCELLED"] },
                $or: [
                  { paymentStatus: { $in: ["paid", "Paid", "PAID"] } },
                  {
                    "payment.paymentStatus": { $in: ["paid", "Paid", "PAID"] },
                  },
                  { "payment.status": { $in: ["paid", "Paid", "PAID"] } },
                ],
              },
            },
            {
              $project: {
                _id: 1,
                user: "$patient",
                hospital: 1,
                amount: { $ifNull: ["$payment.amount", "$amount", 0] },
                type: { $literal: "appointment_booking" },
                status: { $literal: "completed" },
                referenceId: "$_id",
                date: { $ifNull: ["$date", "$createdAt"] },
                admissionId: { $literal: null }, // 🔧 Explicitly null for OPD to prevent grouping
                paymentMode: {
                  $toLower: {
                    $ifNull: [
                      "$payment.paymentMethod",
                      "$payment.paymentMode",
                      "$paymentMethod",
                      "cash",
                    ],
                  },
                },
                reason: { $ifNull: ["$reason", "OPD Consultation"] },
                primaryDoctor: "$doctor",
                patientName: {
                  $ifNull: [
                    "$patientDetails.name",
                    "$patientName",
                    "Unknown Patient",
                  ],
                },
                suggestedDoctorName: "$suggestedDoctorName",
                disease: "$disease",
                diagnosis: "$diagnosis",
                priority: { $literal: 1 },
                transactionId: { $ifNull: ["$transactionId", "$appointmentId", "—"] },
                receiptNumber: { $ifNull: ["$receiptNumber", "$transactionId", "—"] },
              },
            },
          ],
        },
      });
    }

    // 🌍 GLOBAL FILTER STAGE (After Unions, before Grouping)
    const globalMatch: any = { hospital: hospitalObjId };
    if (
      filters?.startDate ||
      filters?.endDate ||
      filters?.status ||
      filters?.patientId
    ) {
      const andMatch: any[] = [];
      if (filters.startDate || filters.endDate) {
        const dateMatch: any = {};
        if (filters.startDate) dateMatch.$gte = new Date(filters.startDate);
        if (filters.endDate) dateMatch.$lte = new Date(filters.endDate);
        andMatch.push({ date: dateMatch });
      }
      if (filters?.status) andMatch.push({ status: filters.status });
      if (filters?.patientId) andMatch.push({ user: patientObjId });
      globalMatch.$and = andMatch;
    }
    pipeline.push({ $match: globalMatch });

    // 🔄 STAGE 4: Grouping for IPD (Admission-based view)
    pipeline.push({
      $group: {
        _id: {
          $cond: {
            if: {
              $and: [
                { $ne: ["$admissionId", null] },
                { $ne: ["$admissionId", ""] },
              ],
            },
            then: "$admissionId",
            else: "$_id", // Fallback to unique record ID for OPD/Others
          },
        },
        doc: { $first: "$$ROOT" },
        // Accrue totals for IPD calculations
        sumAdvance: {
          $sum: {
            $cond: [
              { $in: ["$type", ["ipd_advance", "ipd_admission_fee"]] },
              "$amount",
              0,
            ],
          },
        },
        sumSettlement: {
          $sum: {
            $cond: [
              { $in: ["$type", ["ipd_bill_payment", "ipd_final_settlement"]] },
              "$amount",
              0,
            ],
          },
        },
        maxTotalBill: { $max: "$totalBillAmount" },
        hasDischarge: {
          $max: {
            $cond: [{ $eq: ["$type", "ipd_final_settlement"] }, 1, 0],
          },
        },
      },
    });

    // Re-Project and apply grouped totals back to the main document structure
    pipeline.push({
      $replaceRoot: {
        newRoot: {
          $mergeObjects: [
            "$doc",
            {
              amount: {
                $cond: [
                  { $ne: ["$doc.admissionId", null] },
                  { $add: ["$sumAdvance", "$sumSettlement"] },
                  "$doc.amount",
                ],
              },
              dueAmount: {
                $cond: [
                  { $ne: ["$doc.admissionId", null] },
                  "$sumSettlement",
                  0,
                ],
              },
              advanceAmount: {
                $cond: [{ $ne: ["$doc.admissionId", null] }, "$sumAdvance", 0],
              },
              totalBillAmount: {
                $cond: [
                  { $ne: ["$doc.admissionId", null] },
                  {
                    $max: [
                      "$maxTotalBill",
                      { $add: ["$sumAdvance", "$sumSettlement"] },
                    ],
                  },
                  { $ifNull: ["$doc.totalBillAmount", 0] },
                ],
              },
              type: {
                $cond: [
                  { $eq: ["$hasDischarge", 1] },
                  "ipd_final_settlement",
                  {
                    $cond: [
                      { $gt: ["$sumSettlement", 0] },
                      "ipd_bill_payment",
                      "$doc.type",
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    });

    // 🔥 Final Match & Categorized Filtering
    if (
      filters?.type ||
      (filters?.allowedTypes && filters.allowedTypes.length > 0)
    ) {
      const typeInput = (filters.type || filters.allowedTypes!.join(",")).split(
        ",",
      );
      const finalTypes = typeInput.map(
        (t) => typeMapping[t.toLowerCase()] || t,
      );

      // Expand category objects (like { $in: [...] }) into a flat list or an $or match
      const expandedMatch: any[] = [];
      finalTypes.forEach((t) => {
        if (typeof t === "object" && t.$in) {
          expandedMatch.push({ type: { $in: t.$in } });
        } else {
          expandedMatch.push({ type: t });
        }
      });

      pipeline.push({ $match: { $or: expandedMatch } });
    }

    // Re-apply hospital match on the final combined stream for absolute safety
    pipeline.push({
      $match: {
        hospital: { $in: [hospitalObjId, new mongoose.Types.ObjectId(hospitalObjId)] },
      },
    });
    pipeline.push(
      {
        $addFields: {
          userAsObjectId: {
            $cond: {
              if: {
                $and: [
                  { $ne: ["$user", null] },
                  {
                    $regexMatch: {
                      input: { $toString: "$user" },
                      regex: /^[0-9a-fA-F]{24}$/,
                    },
                  },
                ],
              },
              then: { $toObjectId: "$user" },
              else: "$user",
            },
          },
        },
      },
      { $sort: { priority: -1 } },
      {
        $group: {
          _id: {
            user: "$userAsObjectId",
            amount: "$amount",
            type: "$type",
            referenceId: "$referenceId", // 🛠️ Use referenceId for rock-solid deduplication
            dateMinute: {
              $dateToString: { format: "%Y-%m-%d %H:%M", date: "$date" },
            },
          },
          doc: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$doc" } },
      // Apply Hospital Isolation AGAIN to the grouped stream (Safety fallback)
      {
        $match: {
          hospital: { $in: [hospitalObjId, new mongoose.Types.ObjectId(hospitalObjId)] },
        },
      },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          stats: [
            {
              $group: {
                _id: null,
                totalAmount: {
                  $sum: {
                    $convert: { input: "$amount", to: "double", onError: 0 },
                  },
                },
              },
            },
          ],
          data: [
            { $sort: { date: -1 } },
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: "users",
                localField: "userAsObjectId",
                foreignField: "_id",
                as: "userData",
              },
            },
            {
              $lookup: {
                from: "patients",
                localField: "userAsObjectId",
                foreignField: "_id",
                as: "patientData",
              },
            },
            {
              $addFields: {
                primaryDoctorAsObjectId: {
                  $cond: {
                    if: {
                      $and: [
                        { $ne: ["$primaryDoctor", null] },
                        {
                          $regexMatch: {
                            input: { $toString: "$primaryDoctor" },
                            regex: /^[0-9a-fA-F]{24}$/,
                          },
                        },
                      ],
                    },
                    then: { $toObjectId: "$primaryDoctor" },
                    else: "$primaryDoctor",
                  },
                },
              },
            },
            {
              $lookup: {
                from: "users",
                localField: "primaryDoctorAsObjectId",
                foreignField: "_id",
                as: "directDoctorUser",
              },
            },
            {
              $lookup: {
                from: "doctorprofiles",
                localField: "primaryDoctorAsObjectId",
                foreignField: "_id",
                as: "docProfile",
              },
            },
            {
              $lookup: {
                from: "users",
                localField: "docProfile.user",
                foreignField: "_id",
                as: "userFromProfile",
              },
            },
            {
              $addFields: {
                user: {
                  $cond: {
                    if: { $gt: [{ $size: "$userData" }, 0] },
                    then: { $arrayElemAt: ["$userData", 0] },
                    else: { $arrayElemAt: ["$patientData", 0] },
                  },
                },
                resolvedDoctorName: {
                  $ifNull: [
                    { $arrayElemAt: ["$directDoctorUser.name", 0] },
                    { $arrayElemAt: ["$userFromProfile.name", 0] },
                    {
                      $cond: {
                        if: {
                          $and: [
                            { $ne: ["$primaryDoctor", null] },
                            {
                              $regexMatch: {
                                input: { $toString: "$primaryDoctor" },
                                regex: /^[0-9a-fA-F]{24}$/,
                              },
                            },
                          ],
                        },
                        then: null,
                        else: "$primaryDoctor",
                      },
                    },
                    "$suggestedDoctorName",
                    "-",
                  ],
                },
              },
            },
            {
              $project: {
                user: { name: 1, mobile: 1 },
                hospital: 1,
                amount: 1,
                type: 1,
                status: 1,
                date: 1,
                paymentMode: 1,
                createdAt: 1,
                updatedAt: 1,
                referenceId: {
                  _id: "$referenceId",
                  reason: { $ifNull: ["$reason", "$diagnosis", "-"] },
                  disease: "$disease",
                  diagnosis: "$diagnosis",
                  primaryDoctor: "$resolvedDoctorName",
                  patientName: "$patientName", // 🔧 Pass through to controller
                  phone: "$phone", // 🔧 Pass through to controller
                  suggestedDoctorName: "$suggestedDoctorName",
                  conditionAtDischarge: "$conditionAtDischarge",
                  totalBillAmount: "$totalBillAmount",
                  advanceAmount: "$advanceAmount",
                  dueAmount: "$dueAmount",
                  admissionId: "$admissionId",
                  transactionId: "$transactionId",
                  receiptNumber: "$receiptNumber",
                },
              },
            },
          ],
        },
      },
    );

    const result = await Transaction.aggregate(pipeline);

    const transactions = (result[0].data || []).map((tx: any) => ({
      ...tx,
      patientName: tx.referenceId?.patientName || tx.user?.name || "Unknown",
      patientMobile: tx.referenceId?.phone || tx.user?.mobile || "-",
    }));

    const total = result[0].metadata[0]?.total || 0;
    const totalRevenue = result[0].stats[0]?.totalAmount || 0;

    return {
      transactions,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      totalRevenue,
    };
  }

  /**
   * Invalidate cache for hospital
   */
  async invalidateHospitalCache(hospitalId: string) {
    await redisService.delPattern(`*:${hospitalId}:*`);
    await redisService.delPattern(`*${hospitalId}*`);
    console.log(`🗑️ [Service] Invalidated cache for hospital: ${hospitalId}`);
  }

  /**
   * Payroll Generation & Management
   */
  async generateRangePayroll(
    hospitalId: string,
    startDate: Date,
    endDate: Date,
    processedBy: string,
    userId?: string,
  ) {
    // 1. Get active personnel (filtered by userId if provided)
    const query: any = {
      hospital: { $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)] },
      role: { $in: ["staff", "doctor", "nurse", "emergency", "helpdesk"] },
      status: "active",
    };

    if (userId) {
      query._id = userId;
    }

    const users = await (User.find(query) as any)
      .unscoped()
      .select("name email role")
      .lean();

    // Fetch profiles for all users
    const doctorIds = users
      .filter((u) => u.role === "doctor")
      .map((u) => u._id);
    const staffAndHelpdeskIds = users
      .filter((u) =>
        ["staff", "nurse", "emergency", "helpdesk", "DISCHARGE"].includes(
          u.role,
        ),
      )
      .map((u) => u._id);

    // FIX: Removed .lean() so Mongoose post-hooks run and decrypt bankDetails/panNumber etc.
    // Without this fix, bankAccount stored in Payroll contained raw ciphertext.
    const [doctorProfiles, staffProfiles] = await Promise.all([
      DoctorProfile.find({ user: { $in: doctorIds } }),
      StaffProfile.find({ user: { $in: staffAndHelpdeskIds } }),
    ]);

    // Both staff and helpdesk now use StaffProfile
    const helpdeskProfiles = staffProfiles;

    const validProfiles = users
      .map((user) => {
        let profile: any;
        if (user.role === "doctor") {
          profile = doctorProfiles.find(
            (p) => p.user?.toString() === user._id.toString(),
          );
        } else if (user.role === "helpdesk") {
          profile = helpdeskProfiles.find(
            (p) => p.user && p.user?.toString() === user._id.toString(),
          );
        } else {
          profile = staffProfiles.find(
            (p) => p.user?.toString() === user._id.toString(),
          );
        }

        if (!profile) return null;

        return {
          ...profile,
          user,
          weeklyOff: profile.weeklyOff || [],
          allowances: profile.allowances || [],
          deductions: profile.deductions || [],
          baseSalary: profile.baseSalary || 0,
        };
      })
      .filter((p) => p !== null);

    const results: any[] = [];
    const totalDaysInRange =
      Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;

    for (const profile of validProfiles) {
      if (!profile.user) continue;
      const userObj = profile.user as any;

      // 2. Fetch specific attendance telemetry
      const attendanceRecords = await Attendance.find({
        user: userObj._id,
        hospital: { $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)] },
        date: { $gte: startDate, $lte: endDate },
      }).lean();

      // 3. Fetch approved leaves for the period
      const approvedLeaves = await Leave.find({
        requester: userObj._id,
        hospital: { $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)] },
        status: "approved",
        $or: [{ startDate: { $lte: endDate }, endDate: { $gte: startDate } }],
      }).lean();

      // Helper: Robust local date string YYYY-MM-DD
      const getDateStr = (d: Date) => {
        return (
          d.getFullYear() +
          "-" +
          String(d.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(d.getDate()).padStart(2, "0")
        );
      };

      // Filter attendance to unique list of dates for this user
      const attendanceDateSet = new Set(
        attendanceRecords
          .filter((a) => ["present", "late", "half-day"].includes(a.status))
          .map((a) => getDateStr(new Date(a.date))),
      );

      // 4. Reset counters and calculate stats day-by-day to ensure total accuracy
      let presentDays = 0;
      let leaveDays = 0;
      let paidOffDays = 0;
      let actualAbsentDays = 0;

      // (getDateStr helper has been hoisted above)

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = getDateStr(today);

      for (
        let d = new Date(startDate);
        d <= endDate;
        d.setDate(d.getDate() + 1)
      ) {
        const currentDate = new Date(d);
        const currentTimeStr = getDateStr(currentDate);

        const isOnLeave = approvedLeaves.some((l) => {
          const lS = getDateStr(new Date(l.startDate));
          const lE = getDateStr(new Date(l.endDate));
          return currentTimeStr >= lS && currentTimeStr <= lE;
        });

        const hasAttendance = attendanceDateSet.has(currentTimeStr);

        const dayName = currentDate.toLocaleDateString("en-US", {
          weekday: "long",
        });
        const isWeeklyOff = profile.weeklyOff?.some(
          (wo: string) => wo.toLowerCase() === dayName.toLowerCase(),
        );

        // Strict Day Categorization
        if (isWeeklyOff) {
          paidOffDays++;
        } else if (hasAttendance) {
          presentDays++;
        } else if (isOnLeave) {
          leaveDays++;
        } else if (currentTimeStr < todayStr) {
          // If past today and no attendance/leave/weekly-off, it's an ABSENCE
          actualAbsentDays++;
        }
      }

      // 5. Financial Calculations
      const baseSalary = profile.baseSalary || 0;
      const dayRate = baseSalary / (totalDaysInRange || 30);

      const totalCreditedDays = presentDays + leaveDays + paidOffDays;
      const absentDays = actualAbsentDays; // Use the properly calculated past absences

      // Standardized institutional deduction for unauthorized absence
      const absencePenalty = Math.round(absentDays * dayRate);

      // Calculate Custom Allowances from Profile
      const customAllowancesTotal = profile.allowances.reduce(
        (acc: number, curr: any) => acc + (curr.amount || 0),
        0,
      );
      const customDeductionsTotal = profile.deductions.reduce(
        (acc: number, curr: any) => acc + (curr.amount || 0),
        0,
      );

      // Adjusted Base for Split (only from institutional base salary)
      // Must match earnedBase strictly so mid-month drafts don't artificially inflate the breakdown sum.
      const earnedBase = Math.round(dayRate * totalCreditedDays);
      const adjustedInstitutionalBase = earnedBase;

      // Distribution Engine (50/20/5/5/20 Institutional Split)
      const basic = Math.floor(adjustedInstitutionalBase * 0.5);
      const hra = Math.floor(adjustedInstitutionalBase * 0.2);
      const transportAllowance = Math.floor(adjustedInstitutionalBase * 0.05);
      const medicalAllowance = Math.floor(adjustedInstitutionalBase * 0.05);
      const institutionalSpecialAllowance = Math.max(
        0,
        adjustedInstitutionalBase -
          basic -
          hra -
          transportAllowance -
          medicalAllowance,
      );

      // Final Gross Earning = Adjusted Base Salary + Custom Allowances
      const grossEarning = adjustedInstitutionalBase + customAllowancesTotal;

      // REMOVED statutory taxes as per user request
      const pf = 0;
      const esi = 0;
      const professionalTax = 0;

      const totalStatutoryDeductions = 0;
      const totalDeductions = totalStatutoryDeductions + customDeductionsTotal;
      const totalAllowances =
        hra +
        transportAllowance +
        medicalAllowance +
        institutionalSpecialAllowance +
        customAllowancesTotal;

      // Net Salary is strictly what they've EARNED so far (Credited Days) + Custom Items
      const netSalary = Math.round(
        earnedBase + customAllowancesTotal - customDeductionsTotal,
      );

      // Employer Contribution (CTC)
      const pensionFund = 0;
      const providentFund = 0;
      const employerEsi = 0;
      const totalCTC = grossEarning;

      const payrollData: any = {
        user: userObj._id,
        hospital: { $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)] },
        startDate,
        endDate,
        month: startDate.getMonth() + 1,
        year: startDate.getFullYear(),
        baseSalary: profile.baseSalary,
        totalAllowances,
        totalDeductions,
        netSalary,
        attendanceDays: totalCreditedDays,
        presentDays,
        absentDays,
        leaveDays,
        monthDays: totalDaysInRange,
        weeklyOffDays: paidOffDays,

        // Persist identity snapshot
        bankAccount: profile.bankDetails?.accountNumber || "",
        panNumber: profile.panNumber || "",
        pfNumber: profile.pfNumber || "",
        esiNumber: profile.esiNumber || "",
        uanNumber: profile.uanNumber || "",
        aadharNumber: profile.aadharNumber || "",
        fatherName: profile.fatherName || "",
        dob: profile.dob,
        gender: profile.gender || "",
        workLocation: profile.workLocation || "",
        designation:
          profile.designation ||
          (userObj.role === "doctor" ? "Medical Doctor" : ""),
        department: Array.isArray(profile.department)
          ? profile.department.join(", ")
          : profile.department || "",

        breakdown: {
          basic,
          hra,
          transportAllowance,
          medicalAllowance,
          specialAllowance:
            institutionalSpecialAllowance + customAllowancesTotal,
          salaryArrears: 0,
          bonus: 0,
          pf,
          esi,
          professionalTax,
          salaryAdvance: 0,
          tds: 0,
        },

        ctc: {
          grossEarning,
          pensionFund,
          providentFund,
          employerEsi,
          totalCTC,
        },

        status: "draft",
        processedBy,
        notes: `System Audit: ${presentDays}P, ${leaveDays}L, ${paidOffDays}WOff. Status: ${userObj.role.toUpperCase()}.`,
      };

      try {
        const entry = await Payroll.findOneAndUpdate(
          { user: userObj._id, startDate, endDate },
          payrollData,
          { upsert: true, new: true },
        );
        results.push(entry);
      } catch (e: any) {
        console.error("Failed to generate payroll for user:", userObj._id, e);
      }
    }

    await this.invalidateHospitalCache(hospitalId);
    return results;
  }

  async getPayrollList(
    hospitalId: string,
    startDate?: Date,
    endDate?: Date,
    page: number = 1,
    limit: number = 20,
  ) {
    // 1. Standardize query dates to start/end of day to fix filtering issues
    const query: any = { hospital: { $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)] } };
    if (startDate && endDate) {
      const s = new Date(startDate);
      s.setHours(0, 0, 0, 0);
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);

      // Match records where the payroll cycle overlaps with selected range
      query.$or = [
        { startDate: { $gte: s, $lte: e } },
        { endDate: { $gte: s, $lte: e } },
        { startDate: { $lte: s }, endDate: { $gte: e } },
      ];
    }

    const skip = (page - 1) * limit;

    // 2. Fetch existing payrolls
    const [payrolls, totalExisting, hospital] = await Promise.all([
      Payroll.find(query)
        .populate("user", "name email employeeId role status")
        .sort({ startDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payroll.countDocuments(query),
      Hospital.findById(hospitalId).lean(),
    ]);

    // 3. Get all active personnel to see who is MISSING (to show "default" values)
    const activeUsers = await (
      User.find({
        hospital: { $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)] },
        role: {
          $in: [
            "staff",
            "doctor",
            "nurse",
            "emergency",
            "DISCHARGE",
            "helpdesk",
          ],
        },
        status: "active",
      }) as any
    )
      .unscoped()
      .select("name email role employeeId status")
      .lean();

    const existingUserIds = new Set(
      payrolls.map((p) => p.user?._id?.toString() || p.user?.toString()),
    );

    // 4. Create virtual manifest entries for missing personnel
    const missingPersonnel = activeUsers.filter(
      (u) => !existingUserIds.has(u._id.toString()),
    );

    const virtualPayrolls = await Promise.all(
      missingPersonnel.map(async (u) => {
        let profile: any = null;
        if (u.role === "doctor") {
          // FIX: Removed .lean() — panNumber field requires Mongoose post-hook decryption
          const rawProfile = await DoctorProfile.findOne({ user: u._id })
            .select("baseSalary employeeId panNumber pfNumber");
          profile = rawProfile ? rawProfile.toObject() : null;
        } else {
          // FIX: Removed .lean() — panNumber field requires Mongoose post-hook decryption
          const rawProfile = await StaffProfile.findOne({ user: u._id })
            .select("baseSalary employeeId panNumber pfNumber");
          profile = rawProfile ? rawProfile.toObject() : null;
        }

        return {
          _id: `virtual_${u._id}`,
          user: {
            ...u,
            employeeId: u.employeeId || profile?.employeeId || "HMS_ID_PENDING",
          },
          hospital: hospitalId,
          startDate: startDate || new Date(),
          endDate: endDate || new Date(),
          baseSalary: profile?.baseSalary || 0,
          netSalary:
            (profile?.baseSalary || 0) +
            (profile?.allowances?.reduce(
              (acc: number, c: any) => acc + (c.amount || 0),
              0,
            ) || 0) -
            (profile?.deductions?.reduce(
              (acc: number, c: any) => acc + (c.amount || 0),
              0,
            ) || 0),
          totalAllowances:
            profile?.allowances?.reduce(
              (acc: number, c: any) => acc + (c.amount || 0),
              0,
            ) || 0,
          totalDeductions:
            profile?.deductions?.reduce(
              (acc: number, c: any) => acc + (c.amount || 0),
              0,
            ) || 0,
          presentDays: 0,
          absentDays: 0,
          leaveDays: 0,
          attendanceDays: 0,
          status: "draft",
          isVirtual: true, // Flag for frontend
          notes:
            "Manifest record - click Process Cycle to finalize calculations.",
        };
      }),
    );

    // Merge and Deduplicate by User (to handle multiple records in overlapping ranges)
    const combinedRaw = [...payrolls, ...virtualPayrolls];
    const uniqueMap = new Map();

    combinedRaw.forEach((p: any) => {
      const uid = (p.user?._id || p.user).toString();
      const existing = uniqueMap.get(uid);

      if (!existing) {
        uniqueMap.set(uid, p);
        return;
      }

      // Priority Logic:
      // 1. Paid/Settled records over Draft records
      // 2. Actual records over Virtual records
      // 3. More recent endDate over older ones

      const pStatusVal = p.status === "paid" ? 2 : p.isVirtual ? 0 : 1;
      const eStatusVal =
        existing.status === "paid" ? 2 : existing.isVirtual ? 0 : 1;

      if (pStatusVal > eStatusVal) {
        uniqueMap.set(uid, p);
      } else if (pStatusVal === eStatusVal) {
        // If same status priority, pick the one with later endDate
        if (new Date(p.endDate) > new Date(existing.endDate)) {
          uniqueMap.set(uid, p);
        }
      }
    });

    const combined = Array.from(uniqueMap.values());
    const paginated = combined.slice(0, limit);

    // Enrich with IDs if still missing
    const enriched = await Promise.all(
      paginated.map(async (p: any) => {
        if (p.user && !p.user.employeeId) {
          let profile: any = null;
          if (p.user.role === "doctor") {
            profile = await DoctorProfile.findOne({ user: p.user._id })
              .select("employeeId")
              .lean();
          } else {
            profile = await StaffProfile.findOne({ user: p.user._id })
              .select("employeeId")
              .lean();
          }
          if (profile?.employeeId) p.user.employeeId = profile.employeeId;
        }
        return p;
      }),
    );

    return {
      payrolls: enriched,
      hospital,
      pagination: {
        page,
        limit,
        total: totalExisting + virtualPayrolls.length,
        pages: Math.ceil((totalExisting + virtualPayrolls.length) / limit),
      },
    };
  }

  async updatePayrollStatus(
    payrollId: string,
    status: string,
    paymentDetails?: any,
  ) {
    const update: any = { status };
    if (status === "paid") {
      update.paymentDate = new Date();
      if (paymentDetails) {
        update.paymentMethod = paymentDetails.method;
        update.transactionId = paymentDetails.transactionId;
      }
    }

    return Payroll.findByIdAndUpdate(payrollId, update, { new: true });
  }

  async updatePayroll(payrollId: string, data: any) {
    return Payroll.findByIdAndUpdate(payrollId, data, { new: true });
  }

  // ==================== Helper Methods ====================

  private async getPeriodAppointmentsCount(
    hospitalId: string,
    start: Date,
    end: Date,
    visitType: string = "all",
  ): Promise<number> {
    const hospitalFilter = {
      $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)],
    };
    const query: any = {
      hospital: hospitalFilter,
      date: { $gte: start, $lte: end },
      status: { $ne: "cancelled" },
    };

    if (visitType === "opd" || visitType === "all") {
      query.type = { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] };
      query.visitType = { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] };
      query.isIPD = { $ne: true };
    } else if (visitType === "ipd") {
      query.isIPD = true;
    }

    const count = await (Appointment.countDocuments(query) as any).unscoped();
    console.log(`[DEBUG] getPeriodAppointmentsCount | range: ${start.toISOString()} to ${end.toISOString()} | visitType: ${visitType} | count: ${count}`);
    return count;
  }

  private async getTodayAttendanceCount(hospitalId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Attendance.countDocuments({
      hospital: { $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)] },
      date: { $gte: today },
      status: { $in: ["present", "late"] },
    });
  }

  private async getPendingLeavesCount(hospitalId: string): Promise<number> {
    return Leave.countDocuments({
      hospital: { $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)] },
      status: "pending",
    });
  }

  private async getPeriodRevenue(
    hospitalId: string,
    start: Date,
    end: Date,
    visitType: string = "all",
  ): Promise<number> {
    if (!hospitalId || visitType === "ipd") return 0; // OPD only query, skip if IPD requested

    const match: any = {
      hospital: { $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)] },
      date: { $gte: start, $lte: end },
      $or: [
        { status: "completed" },
        { paymentStatus: { $in: ["paid", "Paid", "PAID"] } },
        { "payment.paymentStatus": { $in: ["paid", "Paid", "PAID"] } },
      ],
    };

    if (visitType === "opd" || visitType === "all") {
      match.type = { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] };
      match.visitType = { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] };
      match.isIPD = { $ne: true };
    }

    console.log(`[DEBUG] getPeriodRevenue Match Query:`, JSON.stringify(match, null, 2));

    const result = await Appointment.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: {
            $sum: { $ifNull: ["$amount", { $ifNull: ["$payment.amount", 0] }] },
          },
        },
      },
    ]);

    const total = result[0]?.total || 0;
    console.log(`[DEBUG] getPeriodRevenue Result: ₹${total}`);
    return total;
  }

  private async getLabOrderCount(
    hospitalId: string,
    start: Date,
    end: Date,
    visitType: string = "all",
  ): Promise<number> {
    if (!hospitalId) return 0;
    const query: any = {
      hospital: hospitalId,
      createdAt: { $gte: start, $lte: end },
    };

    if (visitType === "opd") query.admission = { $exists: false };
    if (visitType === "ipd") query.admission = { $exists: true };

    return (LabOrder.countDocuments(query) as any).unscoped();
  }

  private async getLabRevenue(
    hospitalId: string,
    start: Date,
    end: Date,
    visitType: string = "all",
  ): Promise<number> {
    if (!hospitalId) return 0;
    const match: any = {
      hospital: new mongoose.Types.ObjectId(hospitalId),
      createdAt: { $gte: start, $lte: end },
      paymentStatus: "paid",
    };

    if (visitType === "opd") match.admission = { $exists: false };
    if (visitType === "ipd") match.admission = { $exists: true };

    const result = await LabOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalAmount" },
        },
      },
    ]);
    return result[0]?.total || 0;
  }

  private async getPharmaInvoiceCount(
    hospitalId: string,
    start: Date,
    end: Date,
    visitType: string = "all",
  ): Promise<number> {
    if (!hospitalId) return 0;
    const hospitalFilter = {
      $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)],
    };

    let opdCount = 0;
    let ipdCount = 0;

    if (visitType === "opd" || visitType === "all") {
      opdCount = await (PharmaInvoice.countDocuments({
        hospital: hospitalFilter,
        createdAt: { $gte: start, $lte: end },
      }) as any).unscoped();
    }

    if (visitType === "ipd" || visitType === "all") {
      ipdCount = await (IPDMedicineIssuance.countDocuments({
        hospital: hospitalFilter,
        issuedAt: { $gte: start, $lte: end },
        status: {
          $in: ["ISSUED", "RETURN_REQUESTED", "RETURN_APPROVED", "CLOSED"],
        },
      }) as any).unscoped();
    }

    return opdCount + ipdCount;
  }

  private async getPharmaRevenue(
    hospitalId: string,
    start: Date,
    end: Date,
    visitType: string = "all",
  ): Promise<number> {
    if (!hospitalId) return 0;
    const hospitalFilter = {
      $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)],
    };

    let opdRevenue = 0;
    let ipdRevenue = 0;

    if (visitType === "opd" || visitType === "all") {
      const opdResult = await PharmaInvoice.aggregate([
        {
          $match: {
            hospital: hospitalFilter,
            createdAt: { $gte: start, $lte: end },
            status: "PAID",
          },
        },
        { $group: { _id: null, total: { $sum: "$netPayable" } } },
      ]);
      opdRevenue = opdResult[0]?.total || 0;
    }

    if (visitType === "ipd" || visitType === "all") {
      const ipdResult = await IPDMedicineIssuance.aggregate([
        {
          $match: {
            hospital: hospitalFilter,
            issuedAt: { $gte: start, $lte: end },
            status: {
              $in: ["ISSUED", "RETURN_REQUESTED", "RETURN_APPROVED", "CLOSED"],
            },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);
      ipdRevenue = ipdResult[0]?.total || 0;
    }

    console.log(`[DEBUG] getPharmaRevenue | visitType: ${visitType} | OPD: ₹${opdRevenue} | IPD: ₹${ipdRevenue}`);
    return opdRevenue + ipdRevenue;
  }

  private async getIPDRevenue(
    hospitalId: string,
    start: Date,
    end: Date,
    visitType: string = "all",
  ): Promise<number> {
    if (!hospitalId || visitType === "opd") return 0; // IPD only query
    const hospitalFilter = {
      $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)],
    };

    const [advanceResult, dischargeResult] = await Promise.all([
      IPDAdmission.aggregate([
        {
          $match: {
            hospital: hospitalFilter,
            createdAt: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: null, total: { $sum: "$advancePaid" } } },
      ]),
      DischargeRecord.aggregate([
        {
          $match: {
            hospital: hospitalFilter,
            createdAt: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalPaidAmount" } } },
      ]),
    ]);

    const advance = advanceResult[0]?.total || 0;
    const discharge = dischargeResult[0]?.total || 0;
    const total = advance + discharge;
    console.log(`[DEBUG] getIPDRevenue Result: ₹${total} (Advance: ${advance}, Discharge: ${discharge})`);
    return total;
  }

  private async getBedOccupancy(hospitalId: string): Promise<number> {
    if (!hospitalId) return 0;

    const [totalBeds, occupiedBeds] = await Promise.all([
      (Bed.countDocuments({ hospital: hospitalId }) as any).unscoped(),
      (
        Bed.countDocuments({
          hospital: hospitalId,
          status: { $regex: /^occupied$/i },
        }) as any
      ).unscoped(),
    ]);

    if (totalBeds === 0) return 0;
    return Math.round((occupiedBeds / totalBeds) * 100);
  }

  private async getAvgPatientWaitTime(
    hospitalId: string,
    start: Date,
    end: Date,
    visitType: string = "all",
  ): Promise<number> {
    if (!hospitalId) return 0;
    const match: any = {
      hospital: { $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)] },
      status: "completed",
      consultationStartTime: { $exists: true },
      createdAt: { $exists: true, $gte: start, $lte: end },
    };

    if (visitType === "opd") match.type = { $ne: "IPD" };
    if (visitType === "ipd") match.type = "IPD";

    const result = await Appointment.aggregate([
      { $match: match },
      {
        $project: {
          waitTime: {
            $divide: [
              { $subtract: ["$consultationStartTime", "$createdAt"] },
              60000,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgWait: { $avg: "$waitTime" },
        },
      },
    ]);

    return Math.round(result[0]?.avgWait || 0);
  }

  private async getAvgConsultationTime(
    hospitalId: string,
    start: Date,
    end: Date,
    visitType: string = "all",
  ): Promise<number> {
    if (!hospitalId) return 0;
    const match: any = {
      hospital: { $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)] },
      status: "completed",
      consultationStartTime: { $exists: true },
      consultationEndTime: { $exists: true },
      createdAt: { $exists: true, $gte: start, $lte: end },
    };

    if (visitType === "opd") match.type = { $ne: "IPD" };
    if (visitType === "ipd") match.type = "IPD";

    const result = await Appointment.aggregate([
      { $match: match },
      {
        $project: {
          consultTime: {
            $divide: [
              { $subtract: ["$consultationEndTime", "$consultationStartTime"] },
              60000,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgConsult: { $avg: "$consultTime" },
        },
      },
    ]);

    return Math.round(result[0]?.avgConsult || 0);
  }

  /**
   * Comprehensive Hospital-wide Analytics
   */
  async getHospitalAnalytics(
    hospitalId: string,
    range: string = "30d",
    filters?: { startDate?: string; endDate?: string },
  ) {
    const cacheKey = `hospital:analytics:v2:${hospitalId}:${range}:${filters?.startDate || ""}:${filters?.endDate || ""}`;
    const cached = await redisService.get<any>(cacheKey);
    if (cached) return cached;

    let endDate = new Date();
    let startDate = new Date();

    if (range === "7d") {
      startDate.setDate(endDate.getDate() - 7);
    } else if (range === "30d") {
      startDate.setDate(endDate.getDate() - 30);
    } else if (range === "90d") {
      startDate.setDate(endDate.getDate() - 90);
    } else if (range === "custom" && filters?.startDate && filters?.endDate) {
      startDate = new Date(filters.startDate);
      endDate = new Date(filters.endDate);
      // Ensure time range for custom dates
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    } else {
      startDate.setDate(endDate.getDate() - 30); // Default 30d
    }

    const hospitalObjectId = new mongoose.Types.ObjectId(hospitalId);
    const hospitalFilter = { $in: [hospitalId, hospitalObjectId] };

    // 1. Parallel Aggregations for High Performance
    const allowedTypes = [
      "opd",
      "ipd",
      "appointment_booking",
      "ipd_advance",
      "ipd_refund",
      "ipd_bill_payment",
      "ipd_final_settlement",
      "discharge",
    ];
    const [
      pharmaStats,
      labStats,
      appointmentStats,
      ipdStats,
      ipdDischargeStats,
      avgLengthOfStayStats,
      bedStats,
      doctorStats,
      transactionTrends,
      departmentStats,
      paymentStats,
    ] = await Promise.all([
      // A. Pharmacy Analytics
      PharmaInvoice.aggregate([
        {
          $match: {
            hospital: hospitalFilter,
            createdAt: { $gte: startDate, $lte: endDate },
            status: { $in: ["PAID", "paid", "Paid"] },
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$netPayable" },
            billCount: { $sum: 1 },
          },
        },
      ]),

      // B. Lab Analytics
      LabOrder.aggregate([
        {
          $match: {
            hospital: hospitalFilter,
            createdAt: { $gte: startDate, $lte: endDate },
            paymentStatus: { $in: ["paid", "Paid", "PAID"] },
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$totalAmount" },
            orderCount: { $sum: 1 },
          },
        },
      ]),

      // C. Appointment (OPD) Analytics
      Appointment.aggregate([
        {
          $match: {
            hospital: hospitalFilter,
            date: { $gte: startDate, $lte: endDate },
            status: { $ne: "cancelled" },
            type: { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] },
            visitType: { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] },
            isIPD: { $ne: true },
            $or: [
              { "payment.paymentStatus": { $in: ["paid", "Paid", "PAID"] } },
              { paymentStatus: { $in: ["paid", "Paid", "PAID"] } },
            ],
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: { $ifNull: ["$payment.amount", "$amount"] } },
            aptCount: { $sum: 1 },
          },
        },
      ]),

      // D. IPD Analytics - Admissions & Advances
      IPDAdmission.aggregate([
        {
          $match: {
            hospital: hospitalFilter,
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: null,
            totalInitialRevenue: { $sum: "$advancePaid" },
            admissionCount: { $sum: 1 },
          },
        },
      ]),

      // J. IPD Analytics - Discharges & Final Payments
      DischargeRecord.aggregate([
        {
          $match: {
            hospital: hospitalFilter,
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: null,
            totalFinalRevenue: { $sum: "$finalPayment" },
            dischargeCount: { $sum: 1 },
          },
        },
      ]),

      // K. IPD Analytics - Average Length of Stay
      DischargeRecord.aggregate([
        {
          $match: {
            hospital: hospitalFilter,
            createdAt: { $gte: startDate, $lte: endDate },
            dischargeDate: { $exists: true, $ne: null },
            admissionDate: { $exists: true, $ne: null },
          },
        },
        {
          $project: {
            lengthOfStay: {
              $divide: [
                { $subtract: ["$dischargeDate", "$admissionDate"] },
                1000 * 60 * 60 * 24, // Convert milliseconds to days
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            avgLengthOfStay: { $avg: "$lengthOfStay" },
          },
        },
      ]),

      // E. Bed Status
      Bed.aggregate([
        { $match: { hospital: hospitalObjectId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      // F. Top Doctors - List all consultants for the hospital
      DoctorProfile.aggregate([
        { $match: { hospital: hospitalFilter } },
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "userInfo",
          },
        },
        { $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "appointments",
            let: { docId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$doctor", "$$docId"] },
                  date: { $gte: startDate, $lte: endDate },
                  status: { $ne: "cancelled" },
                  type: { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] },
                  visitType: { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] },
                  isIPD: { $ne: true },
                  $or: [
                    {
                      "payment.paymentStatus": {
                        $in: ["paid", "Paid", "PAID"],
                      },
                    },
                    { paymentStatus: { $in: ["paid", "Paid", "PAID"] } },
                  ],
                },
              },
            ],
            as: "apps",
          },
        },
        {
          $project: {
            name: { $ifNull: ["$userInfo.name", "Consultant"] },
            count: { $size: "$apps" },
            revenue: {
              $reduce: {
                input: "$apps",
                initialValue: 0,
                in: {
                  $add: [
                    "$$value",
                    {
                      $ifNull: [
                        "$$this.payment.amount",
                        { $ifNull: ["$$this.amount", 0] },
                      ],
                    },
                  ],
                },
              },
            },
            _id: 0,
            department: { $ifNull: ["$department", "General"] },
          },
        },
        { $sort: { count: -1 } },
      ]),

      // G. Combined Daily Revenue Trend
      this.getCombinedRevenueTrends(hospitalObjectId, startDate, endDate),

      // H. Departmental Distribution
      this.getDepartmentalRevenue(hospitalObjectId, startDate, endDate),

      // I. Payment method distribution
      Appointment.aggregate([
        {
          $match: {
            hospital: hospitalFilter,
            date: { $gte: startDate, $lte: endDate },
            status: { $ne: "cancelled" },
            type: { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] },
            visitType: { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] },
            isIPD: { $ne: true },
            $or: [
              { "payment.paymentStatus": { $in: ["paid", "Paid", "PAID"] } },
              { paymentStatus: { $in: ["paid", "Paid", "PAID"] } },
            ],
          },
        },
        {
          $group: {
            _id: { $ifNull: ["$payment.paymentMethod", "Cash"] },
            revenue: { $sum: { $ifNull: ["$payment.amount", "$amount"] } },
            count: { $sum: 1 },
          },
        },
        { $project: { method: "$_id", revenue: 1, count: 1, _id: 0 } },
      ]),
    ]);

    const analytics = {
      summary: {
        pharmacy: pharmaStats[0] || {
          totalRevenue: 0,
          billCount: 0,
          avgBillValue: 0,
        },
        lab: labStats[0] || {
          totalRevenue: 0,
          orderCount: 0,
          avgOrderValue: 0,
        },
        appointments: appointmentStats[0] || {
          totalRevenue: 0,
          aptCount: 0,
          avgAptValue: 0,
        },
        ipd: {
          totalRevenue:
            (ipdStats[0]?.totalInitialRevenue || 0) +
            (ipdDischargeStats[0]?.totalFinalRevenue || 0),
          admissionCount: ipdStats[0]?.admissionCount || 0,
          dischargeCount: ipdDischargeStats[0]?.dischargeCount || 0,
          avgLengthOfStay: avgLengthOfStayStats[0]?.avgLengthOfStay || 0,
          totalAdmissions: ipdStats[0]?.admissionCount || 0,
          totalBills:
            (ipdStats[0]?.admissionCount || 0) +
            (ipdDischargeStats[0]?.dischargeCount || 0),
        },
        totalHospitalRevenue:
          (pharmaStats[0]?.totalRevenue || 0) +
          (labStats[0]?.totalRevenue || 0) +
          (appointmentStats[0]?.totalRevenue || 0) +
          (ipdStats[0]?.totalInitialRevenue || 0) +
          (ipdDischargeStats[0]?.totalFinalRevenue || 0),
      },
      bedManagement: bedStats.reduce(
        (acc: any, curr: any) => {
          acc[curr._id.toLowerCase()] = curr.count;
          return acc;
        },
        { vacant: 0, occupied: 0, cleaning: 0, blocked: 0 },
      ),
      doctorPerformance: doctorStats,
      revenueTrends: transactionTrends,
      departmentDistribution: departmentStats,
      paymentDistribution: paymentStats,
      period: { start: startDate, end: endDate, range },
      timestamp: new Date().toISOString(),
    };

    await redisService.set(cacheKey, analytics, 600); // 10 min cache
    return analytics;
  }

  private async getCombinedRevenueTrends(
    hospitalId: mongoose.Types.ObjectId,
    startDate: Date,
    endDate: Date,
  ) {
    // Generate daily buckets
    const days: string[] = [];
    for (
      let d = new Date(startDate);
      d <= endDate;
      d.setDate(d.getDate() + 1)
    ) {
      days.push(new Date(d).toISOString().split("T")[0]);
    }

    const [pharmaDaily, labDaily, aptDaily, ipdDaily, dischargeDaily] =
      await Promise.all([
        PharmaInvoice.aggregate([
          {
            $match: {
              hospital: hospitalId,
              createdAt: { $gte: startDate, $lte: endDate },
              status: { $in: ["PAID", "paid", "Paid"] },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
              },
              amount: { $sum: "$netPayable" },
            },
          },
        ]),
        LabOrder.aggregate([
          {
            $match: {
              hospital: hospitalId,
              createdAt: { $gte: startDate, $lte: endDate },
              paymentStatus: { $in: ["paid", "Paid", "PAID"] },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
              },
              amount: { $sum: "$totalAmount" },
            },
          },
        ]),
        Appointment.aggregate([
          {
            $match: {
              hospital: hospitalId,
              date: { $gte: startDate, $lte: endDate },
              type: { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] },
              visitType: { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] },
              isIPD: { $ne: true },
              $or: [
                { "payment.paymentStatus": { $in: ["paid", "Paid", "PAID"] } },
                { paymentStatus: { $in: ["paid", "Paid", "PAID"] } },
              ],
            },
          },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
              amount: { $sum: { $ifNull: ["$payment.amount", "$amount"] } },
            },
          },
        ]),
        IPDAdmission.aggregate([
          {
            $match: {
              hospital: hospitalId,
              createdAt: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
              },
              amount: { $sum: "$advancePaid" },
            },
          },
        ]),
        DischargeRecord.aggregate([
          {
            $match: {
              hospital: hospitalId,
              createdAt: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
              },
              amount: { $sum: "$finalPayment" },
            },
          },
        ]),
      ]);

    // Merge into historical trend array
    return days.map((day) => {
      const p = pharmaDaily.find((p) => p._id === day)?.amount || 0;
      const l = labDaily.find((l) => l._id === day)?.amount || 0;
      const a = aptDaily.find((a) => a._id === day)?.amount || 0;
      const iInitial = ipdDaily.find((i) => i._id === day)?.amount || 0;
      const iFinal = dischargeDaily.find((i) => i._id === day)?.amount || 0;
      const i = iInitial + iFinal;

      return {
        date: day,
        pharmacy: p,
        lab: l,
        appointments: a,
        ipd: i,
        total: p + l + a + i,
      };
    });
  }

  private async getDepartmentalRevenue(
    hospitalId: any,
    startDate: Date,
    endDate: Date,
  ) {
    const hospitalFilter = {
      $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)],
    };
    return Appointment.aggregate([
      {
        $match: {
          hospital: hospitalFilter,
          date: { $gte: startDate, $lte: endDate },
          type: { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] },
          visitType: { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] },
          isIPD: { $ne: true },
          $or: [
            { "payment.paymentStatus": { $in: ["paid", "Paid", "PAID"] } },
            { paymentStatus: { $in: ["paid", "Paid", "PAID"] } },
          ],
        },
      },
      {
        $group: {
          _id: { $ifNull: ["$department", "General"] },
          revenue: { $sum: { $ifNull: ["$payment.amount", "$amount"] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $project: { department: "$_id", revenue: 1, count: 1, _id: 0 } },
    ]);
  }

  async getLiveQueue(hospitalId: string, doctorId?: string) {
    const query: any = hospitalId ? { hospital: hospitalId } : {};
    if (doctorId) query.doctor = doctorId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const appointments = await Appointment.find({
      ...query,
      status: { $in: ["Booked", "confirmed", "pending", "in-progress"] },
    })
      .sort({ date: 1, updatedAt: -1 })
      .limit(10)
      .populate("patient", "name")
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name" },
      });

    return appointments.map((apt: any) => ({
      _id: apt._id,
      patientName: apt.patient?.name || "Anonymous",
      doctorName: apt.doctor?.user?.name || "Unassigned",
      status: apt.status,
      time:
        apt.appointmentTime ||
        new Date(apt.date).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
    }));
  }

  private async getAppointmentCountByStatus(
    hospitalId: string,
    start: Date,
    end: Date,
    status: string | string[],
  ): Promise<number> {
    const hospitalFilter = {
      $in: [hospitalId, new mongoose.Types.ObjectId(hospitalId)],
    };
    const query: any = {
      hospital: hospitalFilter,
      date: { $gte: start, $lte: end },
      status: Array.isArray(status) ? { $in: status } : status,
    };

    query.type = { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] };
    query.visitType = { $nin: ["IPD", "ipd", "Inpatient", "inpatient"] };
    query.isIPD = { $ne: true };

    const count = await (Appointment.countDocuments(query) as any).unscoped();
    console.log(`[DEBUG] getAppointmentCountByStatus | status: ${status} | count: ${count}`);
    return count;
  }

  private async getIPDDischargeCount(
    hospitalId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    return (IPDAdmission.countDocuments({
      hospital: new mongoose.Types.ObjectId(hospitalId),
      status: "Discharged",
      updatedAt: { $gte: start, $lte: end },
    }) as any).unscoped();
  }
}

// Export singleton instance
export const hospitalAdminService = new HospitalAdminService();
export default hospitalAdminService;