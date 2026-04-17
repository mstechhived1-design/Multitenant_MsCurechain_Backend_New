import express from "express";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import {
  helpDeskDashboard,
  helpdeskLogin,
  helpdeskLogout,
  helpdeskMe,
  updateHelpdeskProfile,
  getHelpDeskById,
  getHelpDeskByHospitalId,
  getHelpDeskDoctors,
} from "../Controllers/helpDeskController.js";
import {
  getPatients,
  getPatientById,
  registerPatient,
  updatePatient,
  getPatientIPDAdmissions,
} from "../Controllers/frontDeskController.js";
import {
  getAppointments,
  updateAppointmentStatus,
  bookAppointment,
} from "../../Appointment/Controllers/bookingController.js";
import {
  createDoctor,
  deleteUser,
} from "../../Admin/Controllers/adminController.js";
import { cacheMiddleware } from "../../middleware/cache.middleware.js";

const router = express.Router();

// Auth & Profile
router.post("/login", helpdeskLogin);
// Refresh is handled centrally via /api/auth/refresh
router.post("/logout", helpdeskLogout);

// Protected Routes Stack
router.use(protect);
router.use(resolveTenant);

// Me/Profile
router.get("/me", helpdeskMe);
router.get("/profile/me", helpdeskMe);
router.put("/me", authorizeRoles("helpdesk"), updateHelpdeskProfile);

// Explicit Tenant Required for below
router.use(requireTenant);

// Dashboard
router.get("/dashboard", authorizeRoles("helpdesk"), helpDeskDashboard);

// Doctors
router.get("/doctors", cacheMiddleware(60), getHelpDeskDoctors);
router.post(
  "/doctor",
  authorizeRoles("hospital-admin", "super-admin"),
  createDoctor,
);

// Patients
router.get("/patients/search", getPatients);
router.get("/patients/:patientId/ipd-admissions", getPatientIPDAdmissions);
router.get("/patients/:patientId", getPatientById);
router.post("/patients/register", registerPatient);
router.put("/patients/:patientId", updatePatient);

// Appointments
router.get("/appointments", getAppointments);
router.post("/appointments", bookAppointment);
router.patch("/appointments/:id/status", updateAppointmentStatus);

// Transactions
import { getTransactions } from "../../Admin/Controllers/adminController.js";
router.get("/transactions", authorizeRoles("helpdesk"), getTransactions);

// Hospital/Helpdesk Details
router.get("/hospital/:hospitalId", getHelpDeskByHospitalId);
router.get("/:id", getHelpDeskById);

router.delete(
  "/:id",
  authorizeRoles("super-admin", "hospital-admin"),
  deleteUser,
);

export default router;
