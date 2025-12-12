/**
 * PDF upload endpoint for manual file uploads.
 * 
 * POST /api/upload-pdf
 *   Body: FormData with 'file' field
 *   Response: { storageLocation: string, filename: string }
 */
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

// Ensure this route runs in Node.js runtime (not Edge) for file system operations
export const runtime = "nodejs";

// For development, store uploads in a local directory
// In production, you'd want to use S3 or similar
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), "uploads", "pdfs");

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type - check both MIME type and file extension
    const isValidPdfType = file.type === "application/pdf" || 
                          file.type === "application/x-pdf" ||
                          file.name.toLowerCase().endsWith(".pdf");
    
    if (!isValidPdfType) {
      return NextResponse.json(
        { error: "File must be a PDF" },
        { status: 400 }
      );
    }

    // Ensure upload directory exists
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filename = `${timestamp}-${sanitizedFilename}`;
    const filePath = join(UPLOAD_DIR, filename);

    // Convert File to Buffer and save
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // Return the storage location (absolute path for now)
    // In production, you might return a URL instead
    return NextResponse.json(
      {
        storageLocation: filePath,
        filename: file.name,
        sizeBytes: file.size,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in POST /api/upload-pdf", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to upload file";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

