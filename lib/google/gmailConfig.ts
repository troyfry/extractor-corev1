/**
 * Gmail configuration constants.
 * 
 * This file contains constants that can be safely imported in both
 * client and server components, without importing the heavy googleapis library.
 */

/**
 * Gmail label name for work orders queue.
 * Can be overridden via GMAIL_WORK_ORDERS_LABEL_NAME environment variable.
 */
export const WORK_ORDERS_LABEL_NAME =
  process.env.GMAIL_WORK_ORDERS_LABEL_NAME || "Work Orders/To Process";

/**
 * Gmail label name for signed work orders.
 * Can be overridden via GMAIL_SIGNED_WORK_ORDERS_LABEL_NAME environment variable.
 */
export const SIGNED_WORK_ORDERS_LABEL_NAME =
  process.env.GMAIL_SIGNED_WORK_ORDERS_LABEL_NAME || "Work Orders/Signed To Match";

/**
 * Gmail label name for processed work orders (optional).
 * Can be overridden via GMAIL_PROCESSED_LABEL_NAME environment variable.
 */
export const PROCESSED_WORK_ORDERS_LABEL_NAME =
  process.env.GMAIL_PROCESSED_LABEL_NAME || "Work Orders/Processed";

// Legacy support
export const WORK_ORDER_LABEL_NAME = WORK_ORDERS_LABEL_NAME;

