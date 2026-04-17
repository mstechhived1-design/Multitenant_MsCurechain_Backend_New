import express from "express";
import {
  createLabTest,
  getLabTests,
  getTestParameters,
  createLabOrder,
  collectSample,
  enterResult,
  notifyDoctorResults,
  finalizeOrder,
  payOrder,
  getInternalOrders,
  generateInvoice,
  getAllInvoices,
  deleteInvoice,
  getLabTest,
  getLabOrder,
  getDepartments,
  getDashboardStats,
  updateLabTest,
  deleteLabTest,
  deleteAllLabTests,
  deleteLabOrder,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getMetaOptions,
  bulkImportDepartments,
  bulkImportTests,
} from "../Controllers/labController.js";
import {
  generateLabReport,
  generateReportWithBilling,
} from "../Controllers/reportController.js";
import {
  getLabSettings,
  updateLabSettings,
  uploadLabLogo,
} from "../Controllers/labSettingsController.js";
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
router.use(requireTenant);

// Catalog Management (Admin/Lab)
router.post(
  "/tests",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  createLabTest,
);
router.delete(
  "/tests/destroy/all",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  deleteAllLabTests,
);
// Bulk import (must be before /:id routes)
router.post(
  "/tests/bulk",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  bulkImportTests,
);
router.post(
  "/departments/bulk",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  bulkImportDepartments,
);

router.get("/tests", getLabTests);
router.get("/tests/:id", getLabTest);
router.get("/tests/:id/parameters", getTestParameters);
router.get("/departments", getDepartments);
router.get("/meta", getMetaOptions);

router.put(
  "/tests/:id",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  updateLabTest,
);
router.delete(
  "/tests/:id",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  deleteLabTest,
);

// Lab Workflow
router.post("/orders", authorizeRoles("lab"), createLabOrder);
router.get(
  "/orders",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  getInternalOrders,
);
router.put("/orders/:id/collect", authorizeRoles("lab"), collectSample);
router.put("/orders/:id/results", authorizeRoles("lab"), enterResult);
router.post(
  "/orders/:id/notify-doctor",
  authorizeRoles("lab"),
  notifyDoctorResults,
);
router.put("/orders/:id/finalize", authorizeRoles("lab"), finalizeOrder);
router.post(
  "/orders/:id/pay",
  authorizeRoles("lab", "patient", "hospital-admin"),
  payOrder,
);
router.get(
  "/orders/:id/invoice",
  authorizeRoles("lab", "patient", "hospital-admin", "super-admin"),
  generateInvoice,
);
router.delete(
  "/orders/:id",
  authorizeRoles("lab", "hospital-admin", "super-admin", "doctor"),
  deleteLabOrder,
);
router.get(
  "/orders/:id",
  authorizeRoles("lab", "hospital-admin", "super-admin", "doctor"),
  getLabOrder,
);

// Invoices
router.get(
  "/invoices",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  getAllInvoices,
);
router.post(
  "/invoices",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  createLabOrder,
);
router.delete(
  "/invoices/:id",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  deleteInvoice,
);

// Reports
router.get(
  "/reports/:sampleId",
  authorizeRoles("lab", "patient", "hospital-admin", "super-admin"),
  generateLabReport,
);
router.get(
  "/reports/:sampleId/with-billing",
  authorizeRoles("lab", "patient", "hospital-admin", "super-admin"),
  generateReportWithBilling,
);

// Dashboard & Analytics
router.get(
  "/dashboard-stats",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  getDashboardStats,
);
router.post(
  "/departments",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  createDepartment,
);
router.put(
  "/departments/:id",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  updateDepartment,
);
router.delete(
  "/departments/:id",
  authorizeRoles("super-admin", "hospital-admin", "lab"),
  deleteDepartment,
);
router.get(
  "/orders/:id",
  authorizeRoles("lab", "hospital-admin", "super-admin", "doctor"),
  getLabOrder,
);

// Lab Settings
router.post(
  "/settings/logo",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  upload.single("logo"),
  uploadLabLogo,
);
router.get(
  "/settings",
  authorizeRoles("lab", "hospital-admin", "super-admin", "doctor"),
  getLabSettings,
);
router.put(
  "/settings",
  authorizeRoles("lab", "hospital-admin", "super-admin"),
  updateLabSettings,
);

export default router;
