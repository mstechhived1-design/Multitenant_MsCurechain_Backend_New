import express from "express";
import {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  me,
  updateMyProfile,
  checkExistence,
  changePassword,
  nurseLogin,
  labLogin,
  pharmaLogin,
  verifyHospital,
} from "../Controllers/authController.js";
import * as emergencyAuthController from "../../Emergency/Controllers/emergencyAuthController.js";
import { body } from "express-validator";
import { protect, optionalProtect } from "../../middleware/Auth/authMiddleware.js";
import { resolveTenant } from "../../middleware/tenantMiddleware.js";
import {
  registerValidator,
  loginValidator,
  refreshValidator,
  changePasswordValidator,
} from "../../utils/validators.js";
import {
  checkAccountLock,
} from "../../middleware/Auth/loginSecurity.js";
import {
  loginLimiter,
  refreshLimiter,
} from "../../middleware/Auth/rateLimitMiddleware.js";

const router = express.Router();

// ─── Public Auth Endpoints ───────────────────────────────────────────────────
router.post("/check-existence", checkExistence);
router.post("/register", loginLimiter, registerValidator, register);

// ✅ MULTI-TAB LOGIN: Hospital verification step (pre-login, no auth required)
// Frontend calls this in Step 1 before asking for user credentials.
router.get("/verify-hospital/:hospitalId", loginLimiter, verifyHospital);

// ✅ SECURITY: Login endpoints now include rate limiting and account lockout
router.post(
  "/login",
  loginLimiter,
  loginValidator,
  checkAccountLock,
  login,
);

// ✅ SECURITY: Refresh endpoint now include refresh-specific rate limiting
router.post("/refresh", refreshLimiter, refreshValidator, refresh);

router.post("/logout", logout);

// ✅ SECURITY: Logout from all devices (requires authentication)
router.post("/logout-all", protect, refreshLimiter, logoutAll);

// ✅ SECURITY: Change password (requires current password, revokes all sessions)
router.post(
  "/change-password",
  protect,
  loginLimiter, 
  changePasswordValidator,
  changePassword,
);

// ─── Role-specific login endpoints ───────────────────────────────────────────
// These enforce role server-side — only the correct role can log in here.
// ✅ SECURITY: All include brute-force protection
router.post(
  "/nurse/login",
  loginLimiter,
  loginValidator,
  checkAccountLock,
  nurseLogin,
);
router.post(
  "/lab/login",
  loginLimiter,
  loginValidator,
  checkAccountLock,
  labLogin,
);
router.post(
  "/pharmacy/login",
  loginLimiter,
  loginValidator,
  checkAccountLock,
  pharmaLogin,
);

// ─── Emergency login: /api/auth/emergency/login ───────────────────────────────
// Ambulance personnel login (uses AmbulancePersonnel model, separate from users)
// Accepts body fields: { identifier, password } OR { mobile, password }
router.post(
  "/emergency/login",
  loginLimiter,
  checkAccountLock,
  // Normalize: map 'mobile' → 'identifier' so the controller always sees 'identifier'
  (req: any, _res: any, next: any) => {
    if (!req.body.identifier && req.body.mobile) {
      req.body.identifier = req.body.mobile;
    }
    next();
  },
  [
    body("identifier").notEmpty().withMessage("Employee ID or Mobile required"),
    body("password").notEmpty().withMessage("Password required"),
  ],
  emergencyAuthController.login,
);

import upload from "../../middleware/Upload/upload.js";

router
  .route("/me")
  .get(optionalProtect, me)
  .patch(protect, resolveTenant, upload.any(), updateMyProfile)
  .put(protect, resolveTenant, upload.any(), updateMyProfile);

router
  .route("/profile")
  .get(optionalProtect, me)
  .patch(protect, resolveTenant, upload.any(), updateMyProfile)
  .put(protect, resolveTenant, upload.any(), updateMyProfile);

export default router;
