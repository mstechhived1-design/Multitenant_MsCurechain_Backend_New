/**
 * LOGIN SECURITY MIDDLEWARE - MSCureChain
 * 
 * Provides progressive brute-force protection.
 * - Tracks failed login attempts per hospital + user identifier
 * - Implements progressive lockout:
 *   5 fails  -> 1 min
 *   10 fails -> 5 min
 *   15 fails -> 10 min
 *   20 fails -> 30 min
 * - Uses Redis for distributed tracking
 * - Resets counter on successful login
 */

import { Request, Response, NextFunction } from "express";
import redisService from "../../config/redis.js";
import User from "../../Auth/Models/User.js";
import Patient from "../../Patient/Models/Patient.js";
import mongoose from "mongoose";

// ─── LOCKOUT CONFIGURATION ───────────────────────────────────────────────────
// These thresholds define when lockouts occur and for how long
const PROGRESSIVE_LOCKOUTS = [
    { threshold: 20, duration: 30 * 60 }, // 20 attempts -> 30 min
    { threshold: 15, duration: 10 * 60 }, // 15 attempts -> 10 min
    { threshold: 10, duration: 5 * 60 },  // 10 attempts -> 5 min
    { threshold: 5,  duration: 1 * 60 },  // 5 attempts  -> 1 min
];

// Maximum attempts tracked before we stop incrementing (keep at max lockout)
const MAX_TRACKED_ATTEMPTS = 50; 
// How long the failure counter stays in Redis without new activity
const ATTEMPT_WINDOW_SECONDS = 24 * 60 * 60; // 24 hours (reset if inactive for a day)

/**
 * Extract the login identifier and hospitalId from the request.
 * If hospitalId is missing, it attempts to resolve it from the database.
 */
async function getLoginContext(req: Request): Promise<{ identifier: string | null; hospitalId: string; userId?: string }> {
    const body = req.body || {};
    const id = (
        body.mobile ||
        body.identifier ||
        body.logid ||
        body.loginId ||
        body.email ||
        ""
    ).toString().trim().toLowerCase();

    if (!id) return { identifier: null, hospitalId: "global" };

    // 1. Try to get hospital from request (headers/body)
    let hospitalId = (req.headers["x-hospital-id"] || body.hospitalId || "").toString().trim();
    let userId: string | undefined;

    // 2. Resolve hospital and user from DB (Zero-Input Multi-Tenancy)
    try {
        // Search User (Doctor/Staff/Admin)
        const user = await (User.findOne({
            $or: [
                { mobile: id },
                { email: id },
                { loginId: id },
                { doctorId: id }
            ]
        }) as any).unscoped();

        if (user) {
            userId = user._id.toString();
            if (!hospitalId || hospitalId === "global") {
                hospitalId = (user.hospital || (user.hospitals && user.hospitals[0]) || "global").toString();
            }
        } else {
            // Search Patient
            const patient = await (Patient.findOne({
                $or: [{ mobile: id }, { email: id }]
            }) as any).unscoped();
            
            if (patient) {
                userId = patient._id.toString();
                if (!hospitalId || hospitalId === "global") {
                    hospitalId = (patient.hospital || (patient.hospitals && patient.hospitals[0]) || "global").toString();
                }
            }
        }
    } catch (err) {
        console.error("[LoginSecurity] Resolution error:", err);
    }

    return { 
        identifier: id, 
        hospitalId: (hospitalId && hospitalId !== "global") ? hospitalId : "global",
        userId
    };
}

/**
 * Get Redis keys
 */
function getAttemptKey(hospitalId: string, identifier: string, userId?: string): string {
    // If we have a DB user ID, use it for perfect tracking across identifier changes
    const target = userId || identifier.replace(/\s+/g, '');
    return `login_fail:${hospitalId}:${target}`;
}

function getLockKey(hospitalId: string, identifier: string, userId?: string): string {
    const target = userId || identifier.replace(/\s+/g, '');
    return `auth:login_locked:${hospitalId}:${target}`;
}

/**
 * PRE-LOGIN middleware: Check if account is locked
 */
export const checkAccountLock = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const { identifier, hospitalId, userId } = await getLoginContext(req);
        
        if (!identifier) return next();

        const lockKey = getLockKey(hospitalId, identifier, userId);
        const remainingTTL = await redisService.ttl(lockKey);

        if (remainingTTL > 0) {
            const minutesRemaining = Math.ceil(remainingTTL / 60);
            
            console.warn(
                `[LOGIN LOCK] Blocked attempt for: ${hospitalId}:${identifier}. Locked for another ${remainingTTL}s (~${minutesRemaining}m).`
            );

            return res.status(429).json({
                message: `Account temporarily locked due to too many failed login attempts. Try again in ${minutesRemaining} minute(s).`,
                retryAfterSeconds: remainingTTL,
            });
        }

        next();
    } catch (err) {
        console.error("[LoginSecurity] Redis error on lock check:", err);
        // FIX: Fail-CLOSED in production — if Redis is down, block login attempts
        // This prevents brute-force attacks during Redis downtime
        if (process.env.NODE_ENV === "production") {
            console.error("[LoginSecurity] FAIL-CLOSED: Blocking login — Redis unavailable in production.");
            return res.status(503).json({
                message: "Authentication temporarily unavailable. Please try again shortly.",
            });
        }
        // Development: allow through
        next();
    }
};

/**
 * Record a FAILED login attempt.
 */
export const recordFailedAttempt = async (identifier: string, hospitalId: string = "global", userId?: string): Promise<{
    locked: boolean;
    lockDuration: number;
    attempts: number;
}> => {
    if (!identifier) return { locked: false, lockDuration: 0, attempts: 0 };

    const normalizedId = identifier.trim().toLowerCase();

    try {
        const attemptKey = getAttemptKey(hospitalId, identifier, userId);
        const count = await redisService.incr(attemptKey);

        // Refresh expiry window for the counter (24 hours)
        await redisService.expire(attemptKey, ATTEMPT_WINDOW_SECONDS);

        console.log(`[LOGIN FAIL] hospitalId: ${hospitalId}, identifier: ${normalizedId}, total attempts: ${count}`);

        /**
         * BATCH LOCKOUT LOGIC:
         * We only trigger a lock when the count EXACTLY matches a threshold,
         * OR when it is above the maximum threshold (persistent protection).
         */
        
        // Final protection: Anything > 20 is always locked for 30 mins
        if (count > 20) {
            const lockKey = getLockKey(hospitalId, identifier, userId);
            await redisService.setex(lockKey, 30 * 60, "locked");
            return { locked: true, lockDuration: 30 * 60, attempts: count };
        }

        // Check for exact thresholds: 5, 10, 15, 20
        const lockout = PROGRESSIVE_LOCKOUTS.find(l => count === l.threshold);

        if (lockout) {
            const lockKey = getLockKey(hospitalId, identifier, userId);
            await redisService.setex(lockKey, lockout.duration, "locked");
            
            console.warn(
                `[LOGIN LOCK] Applied ${lockout.duration/60} min lock to: ${hospitalId}:${normalizedId} at attempt #${count}.`
            );

            return { locked: true, lockDuration: lockout.duration, attempts: count };
        }

        return { locked: false, lockDuration: 0, attempts: count };
    } catch (err) {
        console.error("[LoginSecurity] Redis error on recording attempt:", err);
        return { locked: false, lockDuration: 0, attempts: 0 };
    }
};

/**
 * Clear failed login attempts on successful login.
 */
export const clearFailedAttempts = async (identifier: string, hospitalId: string = "global", userId?: string): Promise<void> => {
    if (!identifier) return;

    const normalizedId = identifier.trim().toLowerCase();

    try {
        const attemptKey = getAttemptKey(hospitalId, normalizedId, userId);
        const lockKey = getLockKey(hospitalId, normalizedId, userId);
        
        await redisService.del(attemptKey);
        await redisService.del(lockKey);
        
        console.log(`[LOGIN SUCCESS] Reset failure counter for: ${hospitalId}:${normalizedId}`);
    } catch (err) {
        console.error("[LoginSecurity] Redis error on clearing attempts:", err);
    }
};

/**
 * Secondary IP-based rate limiter to prevent large scale brute-force.
 */
export const loginRateLimiter = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `auth:ip_login_rate:${ip}`;

    try {
        const count = await redisService.incr(key);

        if (count === 1) {
            await redisService.setex(key, 10 * 60, "1"); // 10 min window
        }

        if (count > 50) { // Limit to 50 attempts per IP per 10 mins
            return res.status(429).json({
                message: "Too many login attempts from this network.",
                retryAfterSeconds: 600,
            });
        }

        next();
    } catch (err) {
        // FIX: Fail-CLOSED in production — if Redis is down, block login attempts
        if (process.env.NODE_ENV === "production") {
            console.error("[LoginSecurity] FAIL-CLOSED: Blocking login — Redis unavailable in production.");
            return res.status(503).json({
                message: "Authentication temporarily unavailable. Please try again shortly.",
            });
        }
        // Development: allow through
        next();
    }
};

export default {
    checkAccountLock,
    recordFailedAttempt,
    clearFailedAttempts,
    loginRateLimiter,
};
