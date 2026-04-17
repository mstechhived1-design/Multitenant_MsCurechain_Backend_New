const getHospitalCode = (hospitalName) => {
  if (!hospitalName) return "HSP";
  
  const words = hospitalName.trim().split(/\s+/).filter(w => w.length > 0);
  
  if (words.length >= 3) {
    return (words[0][0] + words[1][0] + words[2][0]).toUpperCase();
  } else if (words.length >= 1) {
    const firstWord = words[0].replace(/[^a-zA-Z]/g, '');
    return firstWord.substring(0, 3).toUpperCase().padEnd(3, 'X');
  }
  
  return "HSP";
};

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
