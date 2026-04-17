import { getHospitalCode } from '../utils/idGenerator';

const testCases = [
  { name: "Health Science Medical", expected: "HSM" },
  { name: "General Hospital", expected: "GEN" },
  { name: "Clinic", expected: "CLI" },
  { name: "A B C D", expected: "ABC" },
  { name: "St. John's Hospital", expected: "SJH" },
  { name: "   Trimmed   Name   ", expected: "TNA" },
  { name: "One", expected: "ONE" },
  { name: "Two Words", expected: "TWO" }
];

console.log("Testing Hospital Code Generation:");
testCases.forEach(tc => {
  const code = getHospitalCode(tc.name);
  console.log(`Input: "${tc.name}" -> Output: "${code}" | Expected: "${tc.expected}" | ${code === tc.expected ? "PASS" : "FAIL"}`);
});
