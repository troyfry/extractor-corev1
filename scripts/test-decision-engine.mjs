/**
 * Test runner for signedDecisionEngine
 * 
 * Run with: node scripts/test-decision-engine.mjs
 * 
 * This script compiles the TypeScript test file and runs it.
 * Requires: npm install -g typescript tsx (or use npx)
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

console.log("Running signedDecisionEngine tests...\n");

// Try using tsx first (faster, no compilation needed)
const testFile = join(projectRoot, "lib", "workOrders", "signedDecisionEngine.test.ts");

// Use tsx if available, otherwise try ts-node
const runner = spawn("npx", ["tsx", testFile], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: true,
});

runner.on("close", (code) => {
  if (code !== 0) {
    console.error(`\nTest runner exited with code ${code}`);
    console.log("\nAlternative: Compile and run manually:");
    console.log("  npx tsc lib/workOrders/signedDecisionEngine.test.ts --module esnext --target es2020 --moduleResolution node");
    console.log("  node lib/workOrders/signedDecisionEngine.test.js");
    process.exit(code || 1);
  }
});

