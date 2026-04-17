import express from "express";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant, requireTenant } from "../../middleware/tenantMiddleware.js";
import {
  startConsultation,
  endConsultation,
  getConsultationSummary,
  sendToHelpdesk,
  searchMedicines,
  pauseConsultation,
  resumeConsultation,
  getPausedAppointments,
  deleteAppointment,
  saveConsultationDraft,
  getLabResults,
} from "../Controllers/consultationController.js";
import {
  createPrescription,
  getPrescription,
  getPrescriptionsByAppointment,
  updatePrescription,
} from "../../Prescription/Controllers/prescriptionController.js";
import {
  createLabToken,
  getLabToken,
  getLabTokensByAppointment,
  updateLabTokenStatus,
} from "../../Lab/Controllers/labTokenController.js";
import { updateAppointmentStatus } from "../../Appointment/Controllers/bookingController.js";


const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

// Consultation routes
router.post("/appointments/:appointmentId/start", startConsultation);
router.post("/appointments/:appointmentId/end", endConsultation);
router.post("/appointments/:appointmentId/draft", saveConsultationDraft);
router.patch("/appointments/:id/status", updateAppointmentStatus);
router.get("/appointments/:appointmentId/summary", getConsultationSummary);
router.get("/medicines/search", searchMedicines);
router.get("/lab-results", getLabResults);

// Pause/Resume routes
router.post("/appointments/:appointmentId/pause", pauseConsultation);
router.post("/appointments/:appointmentId/resume", resumeConsultation);
router.get("/appointments/paused", getPausedAppointments);
router.delete("/appointments/:appointmentId", deleteAppointment);

// Prescription routes
router.post("/prescriptions", createPrescription);
router.get("/prescriptions/:id", getPrescription);
router.get(
  "/appointments/:appointmentId/prescriptions",
  getPrescriptionsByAppointment,
);
router.put("/prescriptions/:id", updatePrescription);

// Lab token routes
router.post("/lab-tokens", createLabToken);
router.get("/lab-tokens/:id", getLabToken);
router.get(
  "/appointments/:appointmentId/lab-tokens",
  getLabTokensByAppointment,
);
router.put("/lab-tokens/:id/status", updateLabTokenStatus);

router.post("/send-to-helpdesk", sendToHelpdesk);

// Pharmacy token routes
import {
  createPharmacyToken,
  getPharmacyToken,
  getPharmacyTokensByAppointment,
} from "../../Pharmacy/Controllers/pharmacyTokenController.js";

router.post("/pharmacy-tokens", createPharmacyToken);
router.get("/pharmacy-tokens/:id", getPharmacyToken);
router.get(
  "/appointments/:appointmentId/pharmacy-tokens",
  getPharmacyTokensByAppointment,
);

export default router;
