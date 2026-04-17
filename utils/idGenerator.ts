import HospitalCounter from "../Hospital/Models/HospitalCounter.js";
import { nanoid } from "nanoid";

/**
 * Derives a hospital code from its name.
 * - 3+ words: First letter of first three words.
 * - 2 words: First three letters of first word.
 * - 1 word: First three letters.
 */
export const getHospitalCode = (hospitalName: string): string => {
  if (!hospitalName) return "HSP";
  
  const words = hospitalName.trim().split(/\s+/).filter(w => w.length > 0);
  
  if (words.length >= 3) {
    return (words[0][0] + words[1][0] + words[2][0]).toUpperCase();
  } else if (words.length >= 1) {
    // Both 1 and 2 words logic: First three letters of first word
    const firstWord = words[0].replace(/[^a-zA-Z]/g, '');
    return firstWord.substring(0, 3).toUpperCase().padEnd(3, 'X');
  }
  
  return "HSP";
};

/**
 * Generates a unique Transaction ID: TYPE-HHHRRRSSSS
 */
export const generateTransactionId = async (
  hospitalId: any,
  hospitalName: string,
  type: "OPD" | "IPD" | "APT" | "REF",
  session?: any
): Promise<string> => {
  const hhh = getHospitalCode(hospitalName);
  
  // RRR: 3 random digits
  const rrr = Math.floor(100 + Math.random() * 900).toString();
  
  // SSSS: 4-digit auto-incrementing sequence
  const counter = await HospitalCounter.findOneAndUpdate(
    { hospital: hospitalId, type },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, session }
  );
  
  const ssss = counter.sequence.toString().padStart(4, "0");
  
  return `${type}-${hhh}${rrr}${ssss}`;
};

/**
 * Generates a unique Receipt Number: REC-RRRRRR-SSSS#XXXXXXXX
 */
export const generateReceiptNumber = async (
  hospitalId: any,
  session?: any
): Promise<string> => {
  // RRRRRR: 6 random digits
  const rrrrrr = Math.floor(100000 + Math.random() * 900000).toString();
  
  // SSSS: 4-digit sequence
  const counter = await HospitalCounter.findOneAndUpdate(
    { hospital: hospitalId, type: "REC" },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, session }
  );
  
  const ssss = counter.sequence.toString().padStart(4, "0");
  
  // XXXXXXXX: 8-character alphanumeric unique hash
  // nanoid(8) is alphanumeric (a-z, A-Z, 0-9)
  const xxxxxxxx = nanoid(8).toUpperCase();
  
  return `REC-${rrrrrr}-${ssss}#${xxxxxxxx}`;
};
