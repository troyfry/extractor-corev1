/**
 * Processing pipeline for converting EmailMessages into WorkOrders.
 * 
 * This module implements both AI-powered and rule-based parsing:
 * - AI parser (if enabled) attempts to extract structured data from PDFs
 * - Rule-based parser (fallback) extracts work order numbers from filenames/subjects
 * 
 * Architecture:
 * - EmailMessage → WorkOrderInput[] → WorkOrder[] (after duplicate check)
 * - Duplicate detection based on workOrderNumber
 * - Status updates on EmailMessage to track processing state
 */

import type { EmailMessage, EmailAttachment } from "@/lib/emailMessages/types";
import type { WorkOrder, WorkOrderInput } from "@/lib/workOrders/types";
import { workOrderRepo } from "@/lib/workOrders/repository";
import { emailMessageRepo } from "@/lib/emailMessages/repository";
import { aiParseWorkOrdersFromEmail } from "./aiParser";

/**
 * Result of processing a single email message.
 */
export type ProcessEmailResult = {
  email: EmailMessage;
  createdWorkOrders: WorkOrder[];
  skippedAsDuplicate: boolean;
  duplicateWorkOrderNumbers: string[];
};

/**
 * Extract work order number from text (subject or filename).
 * 
 * Patterns supported:
 * - WO# 1910446
 * - WO#1910446
 * - WO 1910446
 * 
 * Fallback: first 6-10 digit sequence is treated as a work order number.
 * 
 * @param subjectOrFilename - Text to search for work order number
 * @returns Work order number if found, null otherwise
 */
export function extractWorkOrderNumberFromText(
  subjectOrFilename: string
): string | null {
  // Try explicit WO# patterns first
  const woPattern = /WO#?\s*(\d{5,10})/i;
  const woMatch = subjectOrFilename.match(woPattern);
  if (woMatch) {
    return woMatch[1];
  }

  // Fallback: look for first 6-10 digit sequence
  const digitPattern = /\b(\d{6,10})\b/;
  const digitMatch = subjectOrFilename.match(digitPattern);
  if (digitMatch) {
    return digitMatch[1];
  }

  return null;
}

/**
 * Build WorkOrderInput[] from an EmailMessage.
 * 
 * For each PDF attachment:
 * - Extract work order number from filename, then from subject
 * - Create a WorkOrderInput with placeholder values
 * 
 * Note: userId must be attached separately after calling this function.
 * 
 * @param email - EmailMessage to process
 * @returns Array of WorkOrderInput objects (one per PDF attachment) - without userId
 */
export function buildWorkOrderInputsFromEmail(
  email: EmailMessage
): Omit<WorkOrderInput, "userId">[] {
  // Filter to only PDF attachments
  const pdfAttachments = email.attachments.filter((att) =>
    att.mimeType.toLowerCase().includes("pdf")
  );

  if (pdfAttachments.length === 0) {
    return [];
  }

  return pdfAttachments.map((attachment, index) => {
    // Try to extract work order number from filename first
    let workOrderNumber = extractWorkOrderNumberFromText(attachment.filename);

    // If not found in filename, try subject
    if (!workOrderNumber) {
      workOrderNumber = extractWorkOrderNumberFromText(email.subject);
    }

    // If still not found, generate a fallback
    if (!workOrderNumber) {
      workOrderNumber = `UNKNOWN-${email.id.slice(0, 8)}-${index}`;
    }

    // Build WorkOrderInput with placeholder values
    // These will be replaced with real data when AI parsing is added
    return {
      workOrderNumber,
      timestampExtracted: email.receivedAt,
      scheduledDate: email.receivedAt,
      // Placeholder values for fields that will be parsed from PDFs later
      serviceAddress: "Unknown facility", // placeholder - will be made smarter later
      jobType: "General service", // placeholder - will be replaced with AI parsing
      // All other fields are optional and will be null for now
      customerName: null,
      vendorName: null,
      jobDescription: null,
      amount: null,
      currency: null,
      notes: null,
      priority: null,
      calendarEventLink: null,
      workOrderPdfLink: attachment.storageLocation ?? null,
    };
  });
}

/**
 * Process a single email message and create WorkOrder records.
 * 
 * Pipeline:
 * 1. Load the email by ID
 * 2. Try AI parsing first (if enabled), fall back to rule-based parser
 * 3. Attach userId to all work order inputs (optional for free version)
 * 4. Check for duplicates by workOrderNumber (scoped to user)
 * 5. Insert only non-duplicate work orders
 * 6. Update email processingStatus
 * 
 * @param emailId - ID of the email message to process
 * @param userId - User ID from authenticated session (optional for free version)
 * @returns ProcessEmailResult or null if email not found
 */
export async function processSingleEmailMessage(
  emailId: string,
  userId?: string | null
): Promise<ProcessEmailResult | null> {
  // 1) Load the email
  const email = await emailMessageRepo.getById(emailId);
  if (!email) {
    return null;
  }

  // 2) Build candidate WorkOrderInput[] - try AI first, then fall back to rule-based
  let candidateInputs: WorkOrderInput[] = [];

  // Try AI parser first (if enabled)
  try {
    const aiResult = await aiParseWorkOrdersFromEmail(email);

    if (aiResult && aiResult.length > 0) {
      // Attach userId to AI results (optional for free version)
      candidateInputs = aiResult.map((wo) => ({ ...wo, userId: userId ?? null })) as WorkOrderInput[];
      console.log(
        `AI parser used for email ${email.id}, produced ${aiResult.length} work order(s)`
      );
    } else {
      // Fall back to rule-based parser
      const ruleBasedInputs = buildWorkOrderInputsFromEmail(email);
      candidateInputs = ruleBasedInputs.map((wo) => ({ ...wo, userId: userId ?? null })) as WorkOrderInput[];
      console.log(
        `AI parser failed or disabled, falling back to rule-based parser for email ${email.id}`
      );
    }
  } catch (aiError) {
    // If AI parser throws an error (not just returns null), log it and fall back
    console.error(
      `AI parser threw an error for email ${email.id}, falling back to rule-based parser:`,
      aiError instanceof Error ? {
        message: aiError.message,
        stack: aiError.stack,
        name: aiError.name,
      } : aiError
    );
    const ruleBasedInputs = buildWorkOrderInputsFromEmail(email);
    candidateInputs = ruleBasedInputs.map((wo) => ({ ...wo, userId: userId ?? null })) as WorkOrderInput[];
  }

  if (candidateInputs.length === 0) {
    // No PDFs → just mark as processed with no created orders
    const updated = await emailMessageRepo.updateStatus(email.id, "processed");
    return {
      email: updated ?? email,
      createdWorkOrders: [],
      skippedAsDuplicate: false,
      duplicateWorkOrderNumbers: [],
    };
  }

  // 3) Ensure userId is set on all candidate inputs (optional for free version)
  const inputsWithUserId = candidateInputs.map((w) => ({
    ...w,
    userId: w.userId ?? userId ?? null,
  }));

  // 4) Duplicate detection by workOrderNumber (scoped to user, or null for free version)
  const numbers = inputsWithUserId.map((w) => w.workOrderNumber);
  const existing = await workOrderRepo.findByWorkOrderNumbers(userId ?? null, numbers);
  const existingNumbers = new Set(existing.map((w) => w.workOrderNumber));

  const newInputs = inputsWithUserId.filter(
    (w) => !existingNumbers.has(w.workOrderNumber)
  );

  const duplicateNumbers = numbers.filter((n) => existingNumbers.has(n));

  let created: WorkOrder[] = [];

  if (newInputs.length > 0) {
    created = await workOrderRepo.saveMany(newInputs);
  }

  const skippedAsDuplicate =
    created.length === 0 && duplicateNumbers.length > 0;

  // 5) Update email processingStatus:
  // - "skipped_duplicate" if everything was a duplicate
  // - "processed" otherwise
  const newStatus = skippedAsDuplicate ? "skipped_duplicate" : "processed";
  const updatedEmail = await emailMessageRepo.updateStatus(email.id, newStatus);

  return {
    email: updatedEmail ?? email,
    createdWorkOrders: created,
    skippedAsDuplicate,
    duplicateWorkOrderNumbers: duplicateNumbers,
  };
}

