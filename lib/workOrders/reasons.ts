/**
 * Constants for "Needs Review" reasons in signed work order processing.
 * 
 * These reasons are used when a signed PDF cannot be automatically processed
 * and requires manual review.
 */

export const NEEDS_REVIEW_REASONS = {
  TEMPLATE_NOT_CONFIGURED: "TEMPLATE_NOT_CONFIGURED",
  TEMPLATE_NOT_FOUND: "TEMPLATE_NOT_FOUND",
  INVALID_CROP: "INVALID_CROP",
  CROP_TOO_SMALL: "CROP_TOO_SMALL",
  PAGE_MISMATCH: "PAGE_MISMATCH",
  LOW_CONFIDENCE_AFTER_RETRY: "LOW_CONFIDENCE_AFTER_RETRY",
  INVALID_WORK_ORDER_NUMBER: "INVALID_WORK_ORDER_NUMBER",
  FMKEY_MISMATCH: "FMKEY_MISMATCH",
  NO_WORK_ORDER_NUMBER: "no_work_order_number",
  NO_MATCHING_JOB_ROW: "no_matching_job_row",
  UPDATE_FAILED: "update_failed",
  LOW_CONFIDENCE: "low_confidence",
} as const;

export type NeedsReviewReason =
  (typeof NEEDS_REVIEW_REASONS)[keyof typeof NEEDS_REVIEW_REASONS];

