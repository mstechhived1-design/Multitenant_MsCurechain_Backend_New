import express from "express";
import {
  getNurseStats,
  getNursePatients,
  getNurseTasks,
  updateNurseTask,
} from "../Controllers/nurseController.js";
import { protect } from "../../middleware/Auth/authMiddleware.js";
import {
  resolveTenant,
  requireTenant,
} from "../../middleware/tenantMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(resolveTenant);
router.use(requireTenant);

router.get("/dashboard/stats", getNurseStats);
router.get("/patients", getNursePatients);
router.get("/tasks", getNurseTasks);
router.put("/tasks/:id", updateNurseTask);

export default router;
