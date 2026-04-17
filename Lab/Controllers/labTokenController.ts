import { Request, Response } from "express";
import LabToken from "../Models/LabToken.js";
import Appointment from "../../Appointment/Models/Appointment.js";
import LabOrder from "../Models/LabOrder.js";
import DoctorProfile from "../../Doctor/Models/DoctorProfile.js";

interface LabTokenRequest extends Request {
  user?: any;
  io?: any;
}

// Create lab token
export const createLabToken = async (req: LabTokenRequest, res: Response) => {
  try {
    const { appointmentId, patientId, tests, priority, notes } = req.body;
    const doctorId = req.user?._id;

    if (!appointmentId && !patientId) {
      return res
        .status(400)
        .json({ message: "Appointment ID or Patient ID is required" });
    }

    if (!tests || tests.length === 0) {
      return res.status(400).json({ message: "At least one test is required" });
    }

    let patient, doctor, hospital;
    // doctorUserId is the User._id (needed for LabOrder.doctor which refs User)
    // doctor is DoctorProfile._id (needed for LabToken.doctor which refs DoctorProfile)
    let doctorUserId: any = doctorId; // fallback to logged-in user

    if (appointmentId) {
      const appointment = await Appointment.findById(appointmentId);
      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }
      patient = appointment.patient;
      doctor = appointment.doctor; // DoctorProfile ID
      hospital = appointment.hospital;

      // Resolve DoctorProfile → User ID for LabOrder.doctor (which refs User)
      const drProfile = await DoctorProfile.findById(doctor)
        .select("user")
        .lean();
      if (drProfile) {
        doctorUserId = (drProfile as any).user;
      }
    } else {
      // Support for existing patients without active appointment
      patient = patientId;
      const doctorProfile = await DoctorProfile.findOne({ user: doctorId });
      if (!doctorProfile) {
        return res.status(404).json({ message: "Doctor profile not found" });
      }
      doctor = doctorProfile._id;
      hospital = doctorProfile.hospital;
      doctorUserId = doctorId; // already the User ID
    }

    // Generate a unique token number
    const count = await LabToken.countDocuments();
    const tokenNumber = `LAB-${Date.now().toString().slice(-6)}-${count + 1}`;

    const labToken = new LabToken({
      appointment: appointmentId || null,
      patient,
      globalPatientId: patient,
      doctor,
      hospital,
      tokenNumber,
      tests,
      priority: priority || "routine",
      notes: notes || "",
    });

    await labToken.save();

    // --- LINK BACK TO APPOINTMENT (if exists) ---
    if (appointmentId) {
      await Appointment.findByIdAndUpdate(appointmentId, {
        labToken: labToken._id,
      });
    }

    // --- NEW: Create LabOrder for Lab Staff View ---
    // Filter tests that have a valid testId (from the frontend selection)
    const validTests = tests
      .filter((t: any) => t.testId)
      .map((t: any) => ({
        test: t.testId,
        testName: t.testName || t.name,
        status: "pending",
        result: "",
        remarks: "",
        isAbnormal: false,
        subTests: [],
      }));

    let labOrder: any = null;
    if (validTests.length > 0) {
      const totalAmount = tests.reduce(
        (sum: number, t: any) => sum + (parseFloat(t.price) || 0),
        0,
      );

      labOrder = await LabOrder.create({
        patient,
        globalPatientId: patient,
        doctor: doctorUserId, // User ID — LabOrder.doctor refs User
        hospital,
        tests: validTests,
        status: "prescribed",
        totalAmount: totalAmount,
        paymentStatus: "pending",
        tokenNumber: tokenNumber,
      });

      // Emit Socket Event to Hospital Room
      if (req.io) {
        const hospitalId = hospital?.toString();
        if (hospitalId) {
          // Populate for frontend display
          const populatedOrder = await LabOrder.findById(labOrder._id)
            .populate("patient", "name age gender mobile")
            .populate("doctor", "name")
            .populate({
              path: "tests.test",
              populate: { path: "departmentId", select: "name" },
            });

          // Use helper or manual mapping to match 'LabSample' frontend type
          // Ideally reuse 'mapOrderToSample' logic if accessible, or replicate minimal needed fields
          const payload = {
            _id: populatedOrder?._id,
            sampleId: populatedOrder?._id.toString().slice(-6).toUpperCase(),
            tokenNumber: tokenNumber,
            patientDetails: {
              name: (populatedOrder?.patient as any)?.name || "N/A",
              age: (populatedOrder?.patient as any)?.age || 0,
              gender: (populatedOrder?.patient as any)?.gender || "N/A",
            },
            sampleType: "Blood/Urine", // Default
            status: "Pending",
            tests: (populatedOrder?.tests || []).map((t: any) => ({
              testName: t.test?.testName || t.test?.name,
              departmentName: t.test?.departmentId?.name || "General",
            })),
            collectionDate: null,
            reportDate: null,
            isNew: true, // Flag for frontend highlight
          };

          req.io.to(`hospital_${hospitalId}`).emit("new_lab_order", payload);
          console.log(`Emitted new_lab_order to hospital_${hospitalId}`);
        }
      }
    }

    res.status(201).json({
      success: true,
      labToken,
      labOrder,
      message: "Lab token and order created successfully",
    });
  } catch (error: any) {
    console.error("Create lab token error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get lab token by ID
export const getLabToken = async (req: LabTokenRequest, res: Response) => {
  try {
    const { id } = req.params;

    const labToken = await LabToken.findById(id)
      .populate("patient", "name mobile email age gender mrn")
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name" },
        select: "specialization medicalRegistrationNumber signature",
      })
      .populate("hospital", "name address")
      .populate(
        "appointment",
        "date mrn appointmentTime vitals patientDetails",
      );

    if (!labToken) {
      return res.status(404).json({ message: "Lab token not found" });
    }

    res.json({
      success: true,
      labToken,
    });
  } catch (error: any) {
    console.error("Get lab token error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get lab tokens by appointment
export const getLabTokensByAppointment = async (
  req: LabTokenRequest,
  res: Response,
) => {
  try {
    const { appointmentId } = req.params;

    const labTokens = await LabToken.find({ appointment: appointmentId })
      .populate("patient", "name mobile email age gender")
      .populate("doctor", "name specialization")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      labTokens,
    });
  } catch (error: any) {
    console.error("Get lab tokens error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update lab token status
export const updateLabTokenStatus = async (
  req: LabTokenRequest,
  res: Response,
) => {
  try {
    const { tokenId } = req.params;
    const { status } = req.body;

    if (!["pending", "collected", "processing", "completed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const labToken = await LabToken.findByIdAndUpdate(
      tokenId,
      { $set: { status } },
      { new: true, runValidators: true },
    );

    if (!labToken) {
      return res.status(404).json({ message: "Lab token not found" });
    }

    res.json({
      success: true,
      labToken,
      message: "Lab token status updated successfully",
    });
  } catch (error: any) {
    console.error("Update lab token status error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all lab tokens for hospital (for lab staff)
export const getHospitalLabTokens = async (
  req: LabTokenRequest,
  res: Response,
) => {
  try {
    const { hospitalId } = req.params;
    const { status } = req.query;

    const query: any = { hospital: hospitalId };
    if (status) {
      query.status = status;
    }

    const labTokens = await LabToken.find(query)
      .populate("patient", "name mobile email")
      .populate("doctor", "name")
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({
      success: true,
      labTokens,
    });
  } catch (error: any) {
    console.error("Get hospital lab tokens error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
