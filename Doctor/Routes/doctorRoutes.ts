import express from "express";
import {
  getDoctorProfile,
  getDoctorDashboard,
  updateDoctorProfile,
  searchDoctors,
  getDoctorById,
  getPatientDetails,
  uploadPhoto,
  startNextAppointment,
  getDoctorCalendarStats,
  getDoctorAppointmentsByDate,
  addQuickNote,
  getQuickNotes,
  getDoctorPatients,
  getDoctorAnalytics,
  deleteQuickNote,
  getDoctorIncomeStats,
  getPatientHistory,
} from "../Controllers/doctorController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";
import upload from "../../middleware/Upload/upload.js";

const router = express.Router();

// Protected Routes Stack
router.use(protect);
router.use(resolveTenant);

// Doctor Profile
router.get(
  "/me",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
  ),
  getDoctorProfile,
);
router.get(
  "/profile/me",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
  ),
  getDoctorProfile,
);
router.put(
  "/me",
  authorizeRoles("doctor", "hospital-admin", "super-admin"),
  upload.any(),
  resolveTenant, // Restore AsyncLocalStorage context lost during multer parsing
  updateDoctorProfile,
);

router.post(
  "/upload-photo",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
  ),
  upload.single("profilePic"),
  resolveTenant,
  uploadPhoto,
);

// Support frontend profile update action
router.patch(
  "/me/photo",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
  ),
  upload.single("profilePic"),
  resolveTenant,
  uploadPhoto,
);

// Explicit Tenant Required for below
router.use(requireTenant);

// Dashboard & Analytics
router.get(
  "/dashboard",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "nurse",
    "lab",
    "pharma-owner",
  ),
  getDoctorDashboard,
);
router.get(
  "/analytics",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "nurse",
    "lab",
    "pharma-owner",
    "helpdesk",
  ),
  getDoctorAnalytics,
);

// Clinical Actions
router.post("/start-next", authorizeRoles("doctor"), startNextAppointment);
router.get(
  "/my-patients",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "nurse",
    "lab",
    "pharma-owner",
    "helpdesk", // Allow helpdesk to view the patients list (prevents intermittent 403 errors)
  ),
  getDoctorPatients,
);
router.get(
  "/patient/:patientId",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "nurse",
    "lab",
    "pharma-owner",
    "helpdesk", // Allow helpdesk to view patient details (prevents intermittent 403 errors)
  ),
  getPatientDetails,
);
router.get(
  "/patient/:patientId/history",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "nurse",
    "lab",
    "pharma-owner",
    "helpdesk",
  ),
  getPatientHistory,
);

// Calendar
router.get(
  "/calendar/stats",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "lab",
    "nurse",
    "pharma-owner",
  ),
  getDoctorCalendarStats,
);
router.get(
  "/calendar/appointments",
  authorizeRoles(
    "doctor",
    "hospital-admin",
    "super-admin",
    "helpdesk",
    "nurse",
  ),
  getDoctorAppointmentsByDate,
);

// Quick Notes
router.post(
  "/quick-notes",
  authorizeRoles("doctor", "nurse", "helpdesk", "hospital-admin", "super-admin"),
  addQuickNote,
);
router.get(
  "/quick-notes",
  authorizeRoles("doctor", "nurse", "helpdesk", "hospital-admin", "super-admin"),
  getQuickNotes,
);
router.delete(
  "/quick-notes/:id",
  authorizeRoles("doctor", "nurse", "helpdesk", "hospital-admin", "super-admin"),
  deleteQuickNote,
);

// Income & Custom Stats
router.get(
  "/income-stats",
  authorizeRoles("doctor", "helpdesk", "hospital-admin", "super-admin"),
  getDoctorIncomeStats,
);

// Helper / Catch-all routes (Placed at end to avoid greedy matching)
router.get("/", searchDoctors);
router.get("/:id", getDoctorById);

export default router;
