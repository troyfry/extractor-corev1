export type NeedsReviewReason =
  | "TEMPLATE_NOT_CONFIGURED"
  | "INVALID_CROP"
  | "CROP_TOO_SMALL"
  | "LOW_CONFIDENCE_AFTER_RETRY"
  | "PAGE_MISMATCH"
  | "TEMPLATE_PAGE_SIZE_MISMATCH"
  | "FMKEY_MISSING"
  | "FMKEY_MISMATCH"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_STALE_OR_WRONG_DOC"
  | "INVALID_WORK_ORDER_NUMBER"
  | "NO_WORK_ORDER_NUMBER"
  | "NO_MATCHING_JOB_ROW"
  | "UPDATE_FAILED"
  | "LOW_CONFIDENCE"
  | "QUICK_CHECK_RECOMMENDED"
  | "NEEDS_ATTENTION"
  | "MANUALLY_RESOLVED"
  | string;

export interface NeedsReviewUx {
  title: string;
  message: string;
  actionLabel: string;
  href: string;
  tone: "warning" | "info" | "danger" | "success";
}

export function getNeedsReviewUx(reason: NeedsReviewReason, fmKey?: string): NeedsReviewUx {
  const templatesLink = fmKey
    ? `/onboarding/templates?fmKey=${encodeURIComponent(fmKey)}`
    : "/onboarding/templates";

  const map: Record<string, NeedsReviewUx> = {
    TEMPLATE_NOT_CONFIGURED: {
      title: "Template not configured",
      message: "No crop zone is saved for this FM template. Draw a rectangle and save it.",
      actionLabel: "Update template",
      href: templatesLink,
      tone: "warning",
    },
    INVALID_CROP: {
      title: "Invalid crop zone",
      message: "The saved crop is off-page or out of bounds. Re-draw and save the rectangle.",
      actionLabel: "Update template",
      href: templatesLink,
      tone: "warning",
    },
    CROP_TOO_SMALL: {
      title: "Crop zone too small",
      message: "The rectangle is too small to reliably read. Make it bigger and save.",
      actionLabel: "Update template",
      href: templatesLink,
      tone: "warning",
    },
    PAGE_MISMATCH: {
      title: "Work order may be on another page",
      message: "The work order number may be on a different page than the template expects. Confirm the correct page and re-save the template.",
      actionLabel: "Update template page",
      href: templatesLink,
      tone: "warning",
    },
    FMKEY_MISSING: {
      title: "FM company not selected",
      message: "This signed PDF didn't include an FM key. Select the FM company and retry.",
      actionLabel: "Pick FM key",
      href: "/pro/signed/upload",
      tone: "danger",
    },
    FMKEY_MISMATCH: {
      title: "Issuer mismatch — please confirm",
      message: "This signed PDF doesn't match the selected issuer profile. Switch issuer and reprocess, or confirm manually.",
      actionLabel: "Reprocess with correct issuer",
      href: "/pro/signed/upload",
      tone: "warning",
    },
    TEMPLATE_NOT_FOUND: {
      title: "Template not found",
      message: "No template exists for this FM key yet. Create a crop zone and save.",
      actionLabel: "Create template",
      href: templatesLink,
      tone: "warning",
    },
    TEMPLATE_STALE_OR_WRONG_DOC: {
      title: "Template doesn't match this PDF",
      message: "The saved page/crop didn't match this document layout. Update the template crop zone/page and retry.",
      actionLabel: "Update template",
      href: templatesLink,
      tone: "warning",
    },
    LOW_CONFIDENCE_AFTER_RETRY: {
      title: "Document quality — please verify",
      message: "After multiple attempts, the extraction wasn't reliable. Please verify the work order number or enter it manually.",
      actionLabel: "Enter WO manually",
      href: "", // UI will open modal
      tone: "info",
    },
    INVALID_WORK_ORDER_NUMBER: {
      title: "Work order number looks unusual — please confirm",
      message: "The extracted number looks unusual. Please verify it's correct or enter it manually.",
      actionLabel: "Enter WO manually",
      href: "", // UI will open modal
      tone: "warning",
    },
    NO_WORK_ORDER_NUMBER: {
      title: "Work order number not detected",
      message: "Work order number not detected in the document. Enter it manually to confirm.",
      actionLabel: "Enter WO manually",
      href: "",
      tone: "info",
    },
    LOW_CONFIDENCE: {
      title: "Document quality — please verify",
      message: "The document quality makes extraction uncertain. Please verify the work order number or enter it manually.",
      actionLabel: "Enter WO manually",
      href: "",
      tone: "info",
    },
    NO_MATCHING_JOB_ROW: {
      title: "WO not found in Sheet1",
      message: "This signed work order can't be matched because the original job row isn't in Sheet1. Upload/extract the original work order first, then resolve.",
      actionLabel: "Go to extractor",
      href: "/pro",
      tone: "danger",
    },
    UPDATE_FAILED: {
      title: "Could not update the matching job row — please verify",
      message: "We found the job row but the update didn't apply. Try again or verify manually.",
      actionLabel: "Retry / Verify",
      href: "",
      tone: "warning",
    },
    QUICK_CHECK_RECOMMENDED: {
      title: "Verification (Recommended)",
      message: "The work order was extracted with moderate confidence. Please verify the number is correct.",
      actionLabel: "Verify WO number",
      href: "",
      tone: "info",
    },
    NEEDS_ATTENTION: {
      title: "Verification (Required)",
      message: "The work order extraction has issues that require verification. Check the extracted number or enter it manually.",
      actionLabel: "Verify / Enter WO manually",
      href: "",
      tone: "warning",
    },
    MANUALLY_RESOLVED: {
      title: "Resolved manually",
      message: "This item was resolved by manual entry.",
      actionLabel: "",
      href: "",
      tone: "success",
    },
  };

  return map[reason] || {
    title: "Verification",
    message: "This item needs verification.",
    actionLabel: "Verify",
    href: "",
    tone: "info",
  };
}

