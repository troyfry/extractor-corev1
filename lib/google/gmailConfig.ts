/**
 * Gmail configuration constants.
 * 
 * This file contains constants that can be safely imported in both
 * client and server components, without importing the heavy googleapis library.
 */

/**
 * Gmail label name for work orders queue.
 * Can be overridden via GMAIL_WORKORDER_LABEL_NAME environment variable.
 */
export const WORK_ORDER_LABEL_NAME =
  process.env.NEXT_PUBLIC_GMAIL_WORKORDER_LABEL_NAME || 
  process.env.GMAIL_WORKORDER_LABEL_NAME || 
  "WorkOrders";

