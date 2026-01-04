/**
 * Gmail label state machine (idempotent).
 * 
 * Labels are organized as a hierarchy under a base label:
 * - Base: "Work Orders" (configurable)
 * - Children:
 *   - "To Process" (queue label)
 *   - "Signed To Match" (for signed work orders)
 *   - "Processed" (success state)
 *   - "Needs Review" (optional, failure state)
 * 
 * All operations are idempotent - safe to call multiple times.
 */

import { createGmailClient } from "./gmail";
import { ensureLabel, type GmailLabel } from "./gmail";
import { validateLabelName } from "./gmailValidation";

/**
 * Label roles in the state machine.
 */
export type LabelRole = "queue" | "signed" | "processed" | "needsReview";

/**
 * Label configuration with both ID and name.
 */
export type LabelConfig = {
  id: string;
  name: string;
};

/**
 * Complete label mapping for a workspace.
 */
export type WorkspaceLabels = {
  base: LabelConfig;
  queue: LabelConfig;
  signed: LabelConfig;
  processed: LabelConfig | null;
  needsReview: LabelConfig | null;
};

/**
 * Default child label names (relative to base).
 */
const CHILD_LABEL_NAMES: Record<LabelRole, string> = {
  queue: "To Process",
  signed: "Signed To Match",
  processed: "Processed",
  needsReview: "Needs Review",
};

/**
 * Create child labels under a base label.
 * 
 * @param accessToken Google OAuth access token
 * @param baseLabelName Base label name (e.g., "Work Orders")
 * @param includeNeedsReview Whether to create the optional "Needs Review" label
 * @returns Label mapping with all created labels
 */
export async function createLabelHierarchy(
  accessToken: string,
  baseLabelName: string = "Work Orders",
  includeNeedsReview: boolean = false
): Promise<WorkspaceLabels> {
  // Validate base label name
  const baseValidationError = validateLabelName(baseLabelName);
  if (baseValidationError) {
    throw new Error(`Invalid base label name: ${baseValidationError}`);
  }

  // Create base label
  const baseLabel = await ensureLabel(accessToken, baseLabelName);

  // Create child labels
  const queueLabel = await ensureLabel(accessToken, `${baseLabelName}/${CHILD_LABEL_NAMES.queue}`);
  const signedLabel = await ensureLabel(accessToken, `${baseLabelName}/${CHILD_LABEL_NAMES.signed}`);
  const processedLabel = await ensureLabel(accessToken, `${baseLabelName}/${CHILD_LABEL_NAMES.processed}`);

  const needsReviewLabel = includeNeedsReview
    ? await ensureLabel(accessToken, `${baseLabelName}/${CHILD_LABEL_NAMES.needsReview}`)
    : null;

  return {
    base: baseLabel,
    queue: queueLabel,
    signed: signedLabel,
    processed: processedLabel,
    needsReview: needsReviewLabel,
  };
}

/**
 * Get current labels on a Gmail message.
 * 
 * @param accessToken Google OAuth access token
 * @param messageId Gmail message ID
 * @returns Array of label IDs currently on the message
 */
export async function getMessageLabels(
  accessToken: string,
  messageId: string
): Promise<string[]> {
  const gmail = createGmailClient(accessToken);
  const message = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Labels"],
  });

  return message.data.labelIds || [];
}

/**
 * Check if a message has a specific label (idempotent check).
 * 
 * @param accessToken Google OAuth access token
 * @param messageId Gmail message ID
 * @param labelId Label ID to check
 * @returns true if message has the label, false otherwise
 */
export async function hasLabel(
  accessToken: string,
  messageId: string,
  labelId: string
): Promise<boolean> {
  const labels = await getMessageLabels(accessToken, messageId);
  return labels.includes(labelId);
}

/**
 * Apply a label to a message (idempotent - only applies if not already present).
 * 
 * @param accessToken Google OAuth access token
 * @param messageId Gmail message ID
 * @param labelId Label ID to apply
 * @returns true if label was applied (or already present), false if operation failed
 */
export async function applyLabelIdempotent(
  accessToken: string,
  messageId: string,
  labelId: string
): Promise<boolean> {
  try {
    // Check if label is already applied (idempotency check)
    if (await hasLabel(accessToken, messageId, labelId)) {
      console.log(`[Gmail Labels] Label ${labelId} already applied to message ${messageId}`);
      return true;
    }

    // Apply label
    const gmail = createGmailClient(accessToken);
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { addLabelIds: [labelId] },
    });

    console.log(`[Gmail Labels] Applied label ${labelId} to message ${messageId}`);
    return true;
  } catch (error) {
    console.error(`[Gmail Labels] Failed to apply label ${labelId} to message ${messageId}:`, error);
    return false;
  }
}

/**
 * Remove a label from a message (idempotent - only removes if present).
 * 
 * @param accessToken Google OAuth access token
 * @param messageId Gmail message ID
 * @param labelId Label ID to remove
 * @returns true if label was removed (or not present), false if operation failed
 */
export async function removeLabelIdempotent(
  accessToken: string,
  messageId: string,
  labelId: string
): Promise<boolean> {
  try {
    // Check if label is not present (idempotency check)
    if (!(await hasLabel(accessToken, messageId, labelId))) {
      console.log(`[Gmail Labels] Label ${labelId} not present on message ${messageId}, skipping removal`);
      return true;
    }

    // Remove label
    const gmail = createGmailClient(accessToken);
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: [labelId] },
    });

    console.log(`[Gmail Labels] Removed label ${labelId} from message ${messageId}`);
    return true;
  } catch (error) {
    console.error(`[Gmail Labels] Failed to remove label ${labelId} from message ${messageId}:`, error);
    return false;
  }
}

/**
 * Transition message from queue to processed (success state).
 * 
 * @param accessToken Google OAuth access token
 * @param messageId Gmail message ID
 * @param labels Workspace label configuration
 * @returns true if transition succeeded, false otherwise
 */
export async function transitionToProcessed(
  accessToken: string,
  messageId: string,
  labels: WorkspaceLabels
): Promise<boolean> {
  try {
    // Remove queue label
    await removeLabelIdempotent(accessToken, messageId, labels.queue.id);

    // Apply processed label (if configured)
    if (labels.processed) {
      await applyLabelIdempotent(accessToken, messageId, labels.processed.id);
    }

    return true;
  } catch (error) {
    console.error(`[Gmail Labels] Failed to transition message ${messageId} to processed:`, error);
    return false;
  }
}

/**
 * Transition message to needs review (failure state).
 * 
 * @param accessToken Google OAuth access token
 * @param messageId Gmail message ID
 * @param labels Workspace label configuration
 * @returns true if transition succeeded, false otherwise
 */
export async function transitionToNeedsReview(
  accessToken: string,
  messageId: string,
  labels: WorkspaceLabels
): Promise<boolean> {
  try {
    // Keep queue label (don't remove it on failure)

    // Apply needs review label (only if configured)
    if (labels.needsReview) {
      await applyLabelIdempotent(accessToken, messageId, labels.needsReview.id);
    }

    return true;
  } catch (error) {
    console.error(`[Gmail Labels] Failed to transition message ${messageId} to needs review:`, error);
    return false;
  }
}

