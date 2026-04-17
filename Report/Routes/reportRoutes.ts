import express from "express";
import { uploadFile, saveReport, getPatientReports, deleteReport, proxyPDF } from "../Controllers/reportController.js";
import upload from "../../middleware/Upload/upload.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";

const router = express.Router();

// Apply auth + tenant context to all report routes
router.use(protect);
router.use(resolveTenant);

router.post("/upload", upload.single("file"), uploadFile);
router.post("/", saveReport);
router.get("/patient/:patientId", getPatientReports);
router.delete("/:id", deleteReport);
router.get("/proxy-pdf/:reportId", proxyPDF);

export default router;
