/**
 * PDF.js loader for Node.js runtime.
 * This file uses CommonJS to properly load pdfjs-dist without webpack bundling issues.
 */

const path = require("path");

// Try to load pdfjs-dist - use absolute path to avoid webpack issues
let pdfjsModule;
try {
  // First try: use module resolution
  pdfjsModule = require("pdfjs-dist/legacy/build/pdf.mjs");
} catch (err1) {
  try {
    // Second try: use absolute path from node_modules
    const pdfjsPath = path.resolve(
      process.cwd(),
      "node_modules",
      "pdfjs-dist",
      "legacy",
      "build",
      "pdf.mjs"
    );
    pdfjsModule = require(pdfjsPath);
  } catch (err2) {
    try {
      // Third try: relative to this file
      const pdfjsPath = path.join(__dirname, "../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs");
      pdfjsModule = require(pdfjsPath);
    } catch (err3) {
      throw new Error(`Failed to load pdfjs-dist: ${err3.message}`);
    }
  }
}

// Export the module - handle both default and named exports
const exported = pdfjsModule.default || pdfjsModule;
module.exports = exported;

