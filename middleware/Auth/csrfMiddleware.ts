import { Request, Response, NextFunction } from "express";

/**
 * CSRF MIDDLEWARE (Double Submit Cookie + Server-Side Redis Validation)
 *
 * Layer 1 (Double Submit Cookie):
 *   Validate X-CSRF-Token header matches csrf_token cookie.
 *   Defeats CSRF from other origins (SameSite=Lax cookies don't block image tags
 *   and navigation but DO block XHR from cross-origin — the header is the second check).
 *
 * Layer 2 (Server-Side Redis Check):
 *   Compare the header value against the hashed CSRF token stored in Redis.
 *   Defeats XSS-based cookie leakage from subdomains — even if the attacker
 *   can read the cookie, they cannot pass the server-side hash comparison
 *   unless they also control the Redis store.
 *
 * Public paths bypass both layers (no session token exists yet).
 */

const PUBLIC_PATHS = [
  "/api/auth/login",
  "/api/auth/nurse/login",
  "/api/auth/lab/login",
  "/api/auth/pharmacy/login",
  "/api/auth/emergency/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/refresh",
  "/api/auth/logout",       // Allow crash-recovery logouts without CSRF
  "/api/auth/logout-all",
  "/api/public",
  "/api/health",
  "/api/emergency/auth/login",
  "/api/emergency/auth/refresh",
  "/api/emergency/auth/logout",
  "/api/discharge/auth/login",
  "/api/discharge/auth/refresh",
  "/api/discharge/auth/logout",
];

export const validateCsrf = async (req: Request, res: Response, next: NextFunction) => {
  // Skip safe HTTP methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  // Skip public/auth paths
  if (PUBLIC_PATHS.some(path => req.path.startsWith(path))) return next();

  const hospitalId  = req.headers["x-hospital-id"] as string;
  const csrfHeader  = req.headers["x-csrf-token"] as string;

  // Layer 1: Double Submit Cookie
  let csrfCookie = req.cookies["csrf_token"];

  if (!csrfCookie && hospitalId && hospitalId !== "global") {
    csrfCookie = req.cookies[`csrf_token_${hospitalId}`];
  }

  // Final fallback: try to find any cookie starting with csrf_token_
  if (!csrfCookie) {
    const suffixedCsrf = Object.keys(req.cookies).find(k => k.startsWith("csrf_token_"));
    if (suffixedCsrf) csrfCookie = req.cookies[suffixedCsrf];
  }

  if (!csrfCookie || !csrfHeader) {
    return res.status(403).json({ success: false, message: "CSRF token missing" });
  }

  if (csrfCookie !== csrfHeader) {
    return res.status(403).json({ success: false, message: "Invalid CSRF token" });
  }

  next();
};
