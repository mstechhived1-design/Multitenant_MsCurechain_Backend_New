import { Request, Response } from "express";
import mongoose from "mongoose";
import asyncHandler from "../../middleware/Error/errorMiddleware.js";
import ApiError from "../../utils/ApiError.js";
import IPDAdmission from "../Models/IPDAdmission.js";
import IPDExtraCharge from "../Models/IPDExtraCharge.js";
import IPDAdvancePayment from "../Models/IPDAdvancePayment.js";
import Transaction from "../../Admin/Models/Transaction.js";
import BedOccupancy from "../Models/BedOccupancy.js";
import Hospital from "../../Hospital/Models/Hospital.js";
import Bed from "../Models/Bed.js";
import redisService from "../../config/redis.js";
import Prescription from "../../Prescription/Models/Prescription.js";
import PharmacyOrder from "../../Pharmacy/Models/PharmacyOrder.js";

// Helper to calculate total bill breakdown
export const calculateBillBreakdown = async (admissionId: string) => {
  let admission: any = null;
  if (mongoose.Types.ObjectId.isValid(admissionId)) {
    admission = await IPDAdmission.findById(admissionId).populate("patient");
  }

  if (!admission) {
    admission = await IPDAdmission.findOne({ admissionId }).populate("patient");
  }

  if (!admission) return null;
  const patientObj: any = admission.patient;

  // 1. Calculate Bed Charges
  const occupancies = await BedOccupancy.find({
    admission: admission._id,
  }).sort({ startDate: 1 }); // Sort by time to find the first occupancy

  const bedIds = occupancies.map((occ) => occ.bed);
  const beds = await Bed.find({ _id: { $in: bedIds } }).lean();
  const bedMap = new Map();
  beds.forEach((b: any) => bedMap.set(b._id.toString(), b));

  const admissionStart = new Date(admission.admissionDate);
  const cutoff = admission.status === "Discharged" ? (admission.updatedAt || new Date()) : new Date();

  let totalBedCharge = 0;
  const bedDetails = occupancies.map((occ, index) => {
    // SECURITY: Use admissionDate for the first occupancy to ensure no gaps from the moment they are admitted
    let start = new Date(occ.startDate);
    if (index === 0 && start > admissionStart) {
      start = admissionStart;
    }

    const end = occ.endDate ? new Date(occ.endDate) : cutoff;
    const diffMs = Math.max(0, end.getTime() - start.getTime());
    const diffHours = diffMs / (1000 * 60 * 60);

    // Pro-rate: For occupancies under 24 hours, charge by hours
    // Minimum charge is 1 hour; for 24+ hours, use ceiling-based day count
    let days: number;
    let charge: number;
    let readableDuration: string;
    const bedInfo: any = bedMap.get(occ.bed.toString());
    const rate = occ.dailyRateAtTime || bedInfo?.pricePerDay || 0;

    // High Precision Billing: Full Days + Pro-rated Hours (30-min units)
    const fullDays = Math.floor(diffHours / 24);
    const remainingMs = diffMs % (1000 * 60 * 60 * 24);
    const remainingHours = remainingMs / (1000 * 60 * 60);

    // Calculate total charge
    charge = fullDays * rate;
    if (remainingMs > 0) {
      // Pro-rate remaining time by 30-minute intervals (unit = 1/48th of a day)
      const diff30MinUnits = Math.ceil(remainingMs / (1000 * 60 * 30));
      charge += Math.round((diff30MinUnits / 48) * rate);
    }

    // Days for reporting (sum of full days + fractional units)
    const totalUnits =
      fullDays * 48 + Math.ceil(remainingMs / (1000 * 60 * 30));
    days = parseFloat((totalUnits / 48).toFixed(4));

    // Human readable duration for this occupancy
    readableDuration = "";
    if (fullDays > 0) {
      readableDuration = `${fullDays} Day(s)${remainingHours >= 0.5 ? ` ${Math.ceil(remainingHours)} Hour(s)` : ""}`;
    } else if (remainingHours >= 1) {
      readableDuration = `${Math.ceil(remainingHours)} Hour(s)`;
    } else {
      readableDuration = `${Math.max(1, Math.ceil(remainingMs / (1000 * 60)))} Mins`;
    }

    totalBedCharge += charge;
    return {
      bedId: bedInfo?.bedId || "Unknown",
      type: bedInfo?.type || "Unknown",
      days,
      readableDuration,
      rate,
      charge,
    };
  });

  // Calculate Total Admission Duration (STRICT READABLE LABEL)
  const totalAdmissionMs = cutoff.getTime() - admissionStart.getTime();
  const totalAdmissionHours = totalAdmissionMs / (1000 * 60 * 60);
  let totalStayReadable = "Less than a minute";

  if (totalAdmissionHours >= 24) {
    const totalDays = Math.floor(totalAdmissionHours / 24);
    const remainingHours = Math.ceil(totalAdmissionHours % 24);
    totalStayReadable = `${totalDays} Day(s)${remainingHours > 0 ? ` ${remainingHours} Hour(s)` : ""}`;
  } else if (totalAdmissionHours >= 1) {
    totalStayReadable = `${Math.ceil(totalAdmissionHours)} Hour(s)`;
  } else {
    const totalMins = Math.max(1, Math.ceil(totalAdmissionMs / (1000 * 60)));
    totalStayReadable = `${totalMins} Mins`;
  }

  // 2. Aggregate Extra Charges
  const extraCharges = await IPDExtraCharge.find({
    admission: admission._id,
    status: "Active",
  });
  const categoryBreakdown: any = {};
  let totalExtraCharge = 0;
  let totalReturnCredit = 0;

  extraCharges.forEach((charge) => {
    if (charge.category === "Pharmacy" && charge.amount < 0) {
      totalReturnCredit += Math.abs(charge.amount);
    } else {
      if (!categoryBreakdown[charge.category])
        categoryBreakdown[charge.category] = 0;
      categoryBreakdown[charge.category] += charge.amount;
      totalExtraCharge += charge.amount;
    }
  });

  // Support for "Starting IPD Fee" from admission model
  // Note: As per user request, Admission Fee is treated as an Advance/Deduction, 
  // so it should not be added to the Total Extra Charges.
  if (admission.amount > 0) {
    // We only keep the virtual push if we want it to show up in the Extra Charges list, 
    // but the user said "dont add this... into total amount", so we remove the addition.
  }

  // 3. Aggregate Advances
  const advances = await IPDAdvancePayment.find({ admission: admission._id });
  let totalAdvance = 0;
  let totalSettlementFromAdvances = 0; // Initialize settlement tracker

  advances.forEach((adv) => {
    if (adv.transactionType === "Advance") {
      totalAdvance += adv.amount;
    } else if (adv.transactionType === "Refund") {
      totalAdvance -= adv.amount;
    } else if (adv.transactionType === "Settlement") {
      totalSettlementFromAdvances += adv.amount;
    }
  });

  // SMART FALLBACK: For existing/legacy patients, handle initial advance from IPDAdmission model
  const initialAdvance =
    admission.paymentStatus === "paid" && admission.amount > 0
      ? admission.amount
      : 0;

  // If the denormalized advancePaid or the initial amount is higher than the sum of records,
  // it means the initial payment wasn't recorded in the IPDAdvancePayment collection (legacy data)
  const denormalizedAdvance = Math.max(
    admission.advancePaid || 0,
    initialAdvance,
  );

  if (denormalizedAdvance > totalAdvance) {
    // Find the diff
    const diff = denormalizedAdvance - totalAdvance;

    // Add a virtual "Initial Payment" record so it shows up in the ledger
    const virtualAdvance = {
      _id: "virtual-initial-" + admission._id,
      amount: diff,
      mode: admission.paymentMethod || "Cash",
      transactionType: "Advance",
      date: admission.admissionDate || admission.createdAt,
      description: "Opening Advance / Admission Fee",
      isVirtual: true,
    };

    // Add to list and update total
    (advances as any).push(virtualAdvance);
    totalAdvance = denormalizedAdvance;
  }

  // 4. Totals Calculation
  const extraChargesTotal = totalBedCharge + totalExtraCharge;
  const totalBill = extraChargesTotal - totalReturnCredit;
  const discount = admission.discountDetails?.amount || 0;
  const finalAmount = totalBill - discount;

  // Use both the legacy settlementPaid field from admission and the new tracked advances array
  const totalSettlement = Math.max((admission as any).settlementPaid || 0, totalSettlementFromAdvances);

  // Balance is total clinical charges minus all payments (advances + settlements) and discounts
  const balance = totalBill - totalAdvance - totalSettlement - discount;

  return {
    admissionId: admission.admissionId,
    patientName: patientObj?.name || "Unknown Patient",
    bedCharges: {
      items: bedDetails,
      total: totalBedCharge,
      totalStayReadable,
    },
    extraCharges: {
      items: extraCharges,
      categoryBreakdown,
      total: totalExtraCharge,
    },
    financials: {
      totalBill,
      discount,
      finalAmount,
      totalAdvance,
      totalSettlement,
      totalPaid: totalAdvance + totalSettlement,
      remainingAmount: Math.max(0, totalBill - totalAdvance), // Amount left to be settled
      balance,
      returnCredits: totalReturnCredit,
    },
    advances: advances.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    ),
    isBillLocked: admission.isBillLocked,
    status: admission.status,
  };
};

export const addExtraCharge = asyncHandler(async (req: any, res: Response) => {
  const { admissionId, category, description, amount, date } = req.body;

  let admission: any = null;
  if (mongoose.Types.ObjectId.isValid(admissionId)) {
    admission = await IPDAdmission.findById(admissionId);
  }

  if (!admission) {
    admission = await IPDAdmission.findOne({ admissionId });
  }

  if (!admission) throw new ApiError(404, "Admission not found");
  if (admission.isBillLocked)
    throw new ApiError(400, "Bill is locked. Cannot add charges.");

  const charge = await IPDExtraCharge.create({
    patient: admission.patient,
    globalPatientId: admission.patient,
    admission: admission._id,
    hospital: admission.hospital,
    category,
    description,
    amount,
    date: date || new Date(),
    addedBy: req.user._id,
  });

  // Update aggregate total on admission
  await IPDAdmission.findByIdAndUpdate(admission._id, {
    $inc: { totalBilledAmount: amount },
  });

  await redisService.del(`ipd:bill:${admission._id}`);
  await redisService.del(`ipd:bill:${admission.admissionId}`);
  res.status(201).json(charge);
});

export const removeExtraCharge = asyncHandler(
  async (req: any, res: Response) => {
    const { chargeId } = req.params;

    const charge = await IPDExtraCharge.findById(chargeId);
    if (!charge) throw new ApiError(404, "Charge not found");

    const admission = await IPDAdmission.findById(charge.admission);
    if (!admission) throw new ApiError(404, "Admission not found");
    if (admission.isBillLocked)
      throw new ApiError(400, "Bill is locked. Cannot remove charges.");

    // Decrease the total billed amount
    await IPDAdmission.findByIdAndUpdate(admission._id, {
      $inc: { totalBilledAmount: -charge.amount },
    });

    // Delete the charge
    await IPDExtraCharge.findByIdAndDelete(chargeId);

    // Clear cache
    await redisService.del(`ipd:bill:${admission._id}`);
    await redisService.del(`ipd:bill:${admission.admissionId}`);

    res.json({ message: "Charge removed successfully" });
  },
);

export const addAdvancePayment = asyncHandler(
  async (req: any, res: Response) => {
    const { admissionId, amount, mode, reference, transactionType, date } =
      req.body;

    let admission: any = null;
    if (mongoose.Types.ObjectId.isValid(admissionId)) {
      admission = await IPDAdmission.findById(admissionId);
    }

    if (!admission) {
      admission = await IPDAdmission.findOne({ admissionId });
    }

    if (!admission) throw new ApiError(404, "Admission not found");

    const effectiveTransactionType = transactionType || (admission.status === "Discharge Initiated" ? "Settlement" : "Advance");

    const payment = await IPDAdvancePayment.create({
      patient: admission.patient,
      globalPatientId: admission.patient,
      admission: admission._id,
      hospital: admission.hospital,
      amount,
      mode,
      reference,
      transactionType: effectiveTransactionType,
      date: date || new Date(),
      receivedBy: req.user._id,
    });

    // Update aggregate totals on admission
    const updateQuery: any = { $inc: {} };
    if (effectiveTransactionType === "Settlement") {
      updateQuery.$inc.settlementPaid = amount;

      // ✅ SYNC PHARMACY ORDERS: Mark all linked pharmacy orders as PAID
      try {
        const pharmaUpdate = await PharmacyOrder.updateMany(
          { admission: admission._id, hospital: admission.hospital },
          { $set: { paymentStatus: "paid" } }
        );
        console.log(`[Billing Sync] Marked ${pharmaUpdate.modifiedCount} pharmacy orders as PAID for admission ${admission.admissionId}`);
      } catch (pharmaErr) {
        console.error("[Billing Sync] Failed to sync pharmacy payment status:", pharmaErr);
      }
    } else if (effectiveTransactionType === "Refund") {
      updateQuery.$inc.advancePaid = -amount;
    } else {
      // Default to "Advance"
      updateQuery.$inc.advancePaid = amount;
    }

    await IPDAdmission.findByIdAndUpdate(admission._id, updateQuery);

    const normalizedMode = mode?.toLowerCase() || "cash";
    const validTransactionModes = ["cash", "upi", "card", "mixed", "other"];
    const transactionMode = validTransactionModes.includes(normalizedMode)
      ? normalizedMode
      : "other"; // 'insurance', 'bank transfer' fall into 'other'

    // ✅ RECORD TRANSACTION: For Helpdesk Financial Tracking & Super Admin Revenue
    await Transaction.create({
      user: admission.patient,
      userModel: "Patient",
      hospital: admission.hospital,
      amount: Number(amount),
      type: effectiveTransactionType === "Settlement" ? "ipd_settlement" :
        effectiveTransactionType === "Refund" ? "ipd_refund" : "ipd_advance",
      status: "completed",
      referenceId: admission._id,
      date: date || new Date(),
      paymentMode: transactionMode,
      paymentDetails: {
        cash: transactionMode === "cash" ? Number(amount) : 0,
        upi: transactionMode === "upi" ? Number(amount) : 0,
        card: transactionMode === "card" ? Number(amount) : 0,
      },
    });

    await redisService.del(`ipd:bill:${admission._id}`);
    await redisService.del(`ipd:bill:${admission.admissionId}`);

    res.status(201).json(payment);
  },
);

export const getBillSummary = asyncHandler(
  async (req: Request, res: Response) => {
    const { admissionId } = req.params;

    // Check cache
    const cached = await redisService.get(`ipd:bill:${admissionId}`);
    if (cached) return res.json(cached);

    const breakdown = await calculateBillBreakdown(admissionId);
    if (!breakdown) throw new ApiError(404, "Admission not found");

    await redisService.set(`ipd:bill:${admissionId}`, breakdown, 60); // Cache for 1 min
    res.json(breakdown);
  },
);

export const applyDiscount = asyncHandler(async (req: any, res: Response) => {
  const { admissionId, amount, reason } = req.body;

  let admission: any = null;
  if (mongoose.Types.ObjectId.isValid(admissionId)) {
    admission = await IPDAdmission.findById(admissionId);
  }

  if (!admission) {
    admission = await IPDAdmission.findOne({ admissionId });
  }

  if (!admission) throw new ApiError(404, "Admission not found");
  if (admission.isBillLocked) throw new ApiError(400, "Bill is locked.");

  admission.discountDetails = {
    amount,
    reason,
    approvedBy: req.user._id,
  };
  await admission.save();

  await redisService.del(`ipd:bill:${admission._id}`);
  await redisService.del(`ipd:bill:${admission.admissionId}`);
  res.json({
    message: "Discount applied successfully",
    discountDetails: admission.discountDetails,
  });
});

export const lockBill = asyncHandler(async (req: any, res: Response) => {
  const { admissionId } = req.params;

  let admission: any = null;
  if (mongoose.Types.ObjectId.isValid(admissionId)) {
    admission = await IPDAdmission.findById(admissionId);
  }

  if (!admission) {
    admission = await IPDAdmission.findOne({ admissionId });
  }

  if (!admission) throw new ApiError(404, "Admission not found");

  admission.isBillLocked = true;
  await admission.save();

  await redisService.del(`ipd:bill:${admission._id}`);
  await redisService.del(`ipd:bill:${admission.admissionId}`);
  res.json({
    message: "Bill locked successfully. No further changes allowed.",
  });
});
