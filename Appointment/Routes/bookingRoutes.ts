import express from "express";
import {
  bookAppointment,
  checkAvailability,
  updateAppointmentStatus,
  getAppointments,
  getHospitalAppointmentStats,
  getAppointmentById,
  // verifyPayment
} from "../Controllers/bookingController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { authorizeRoles } from "../../middleware/Auth/roleMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

router.post("/book", authorizeRoles("patient"), bookAppointment);
router.get(
  "/availability",
  authorizeRoles("patient", "helpdesk", "hospital-admin"),
  checkAvailability,
);
router.patch(
  "/:id/status",
  authorizeRoles(
    "doctor",
    "helpdesk",
    "patient",
    "hospital-admin",
    "nurse",
    "lab",
  ),
  updateAppointmentStatus,
);

router.get(
  "/my-appointments",
  authorizeRoles(
    "patient",
    "doctor",
    "helpdesk",
    "hospital-admin",
    "nurse",
    "lab",
    "pharma-owner",
  ),
  getAppointments,
);
router.get(
  "/hospital/stats",
  authorizeRoles("hospital-admin", "super-admin", "helpdesk"),
  getHospitalAppointmentStats,
);
router.get(
  "/hospital-stats",
  authorizeRoles("hospital-admin", "super-admin", "helpdesk"),
  getHospitalAppointmentStats,
);
router.get(
  "/:id",
  authorizeRoles(
    "patient",
    "doctor",
    "helpdesk",
    "hospital-admin",
    "nurse",
    "lab",
    "pharma-owner",
  ),
  getAppointmentById,
);

// router.post("/verify-payment", protect, authorizeRoles("patient"), verifyPayment);

export default router;
