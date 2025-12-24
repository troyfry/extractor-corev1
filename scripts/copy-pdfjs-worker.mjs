import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const rootDir = join(__dirname, "..");
const sourcePath = join(rootDir, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs");
const destDir = join(rootDir, "public");
const destPath = join(destDir, "pdf.worker.min.mjs");

try {
  // Ensure public directory exists
  mkdirSync(destDir, { recursive: true });

  // Read source file
  const workerContent = readFileSync(sourcePath, "utf8");

  // Write to destination
  writeFileSync(destPath, workerContent, "utf8");

  console.log(`[copy-pdfjs-worker] Copied ${sourcePath} → ${destPath}`);
} catch (error) {
  console.error("[copy-pdfjs-worker] Error:", error.message);
  process.exit(1);
}

