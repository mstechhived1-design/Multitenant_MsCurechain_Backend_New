import express from "express";
import { checkSymptoms, generatePrescription } from "../Controllers/aiController.js";

const router = express.Router();

router.post("/check-symptoms", checkSymptoms);
router.post("/prescription", generatePrescription);

export default router;
