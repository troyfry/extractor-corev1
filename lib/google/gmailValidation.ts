/**
 * Gmail label validation helpers.
 * 
 * INBOX is a system label and cannot be used as a custom label.
 */

/**
 * System labels that cannot be used as custom labels.
 */
const FORBIDDEN_LABELS = [
  "INBOX",
  "SENT",
  "DRAFT",
  "SPAM",
  "TRASH",
  "IMPORTANT",
  "STARRED",
  "UNREAD",
] as const;

/**
 * Validate that a label name is not a forbidden system label.
 * 
 * @param labelName Label name to validate
 * @returns Error message if invalid, null if valid
 */
export function validateLabelName(labelName: string): string | null {
  const normalized = labelName.trim().toUpperCase();
  
  if (FORBIDDEN_LABELS.includes(normalized as typeof FORBIDDEN_LABELS[number])) {
    return `${labelName} is a system label and cannot be used. Please choose a different label name.`;
  }
  
  if (labelName.trim().length === 0) {
    return "Label name cannot be empty.";
  }
  
  return null;
}

/**
 * Check if a label name is forbidden.
 * 
 * @param labelName Label name to check
 * @returns true if forbidden, false otherwise
 */
export function isForbiddenLabel(labelName: string): boolean {
  const normalized = labelName.trim().toUpperCase();
  return FORBIDDEN_LABELS.includes(normalized as typeof FORBIDDEN_LABELS[number]);
}

