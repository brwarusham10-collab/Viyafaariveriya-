// Server error codes → plain-language messages that say what happened and how to fix it.
import { formatMoney } from "./money";

type Detail = Record<string, unknown> | string | null | undefined;

const messages: Record<string, string | ((d: Detail) => string)> = {
  NOT_AUTHENTICATED: "Your session has ended. Sign in again to continue.",
  PERMISSION_DENIED: "Your role doesn't allow this action. Ask a manager to do it or to change your role.",
  OUTLET_ACCESS_DENIED: "You aren't assigned to this outlet.",
  ORGANIZATION_SUSPENDED: "This business is suspended. Sales and stock changes are paused until it's reactivated.",
  INSUFFICIENT_STOCK: (d) =>
    typeof d === "object" && d ? `Not enough stock: ${d.available} available, ${d.requested} needed.` : "Not enough stock for this item.",
  INSUFFICIENT_PAYMENT: (d) =>
    typeof d === "object" && d ? `Payment is short. Total ${formatMoney(d.total as number)}, received ${formatMoney(d.paid as number)}.` : "Payment doesn't cover the total.",
  OVERPAYMENT_NON_CASH: "Card, transfer and account payments can't exceed the total. Only cash can give change.",
  CREDIT_LIMIT_EXCEEDED: (d) =>
    typeof d === "object" && d
      ? `This would take the account over its ${formatMoney(d.limit as number)} limit (current balance ${formatMoney(d.balance as number)}).`
      : "This would exceed the customer's credit limit.",
  INSUFFICIENT_STORE_CREDIT: "The customer doesn't have enough store credit.",
  CUSTOMER_REQUIRED: "Attach a customer to use store credit or charge an account.",
  PAYMENT_REFERENCE_REQUIRED: "Enter the transfer reference from the customer's bank receipt.",
  PAYMENT_METHOD_NOT_ALLOWED_OFFLINE: "This payment method needs a connection. Use cash or card while offline.",
  SHIFT_CLOSED: "This register's shift is closed. Open a new shift to continue.",
  SHIFT_ALREADY_OPEN: "A shift is already open on this register.",
  SHIFT_NOT_FOUND: "Open a shift on this register before selling.",
  REFUND_EXCEEDS_SOLD: "That's more than was sold (or already refunded) on this line.",
  PAYOUT_MISMATCH: (d) =>
    typeof d === "object" && d ? `Payouts must add up to the refund total of ${formatMoney(d.refund_total as number)}.` : "Payouts must equal the refund total.",
  OPEN_SHIFT_REQUIRED_FOR_CASH: "Cash payouts and collections need an open shift on this register.",
  VOID_ONLY_IN_OPEN_SHIFT: "Sales can only be voided while their shift is still open. Use a refund instead.",
  SALE_HAS_REFUNDS: "This sale already has refunds. Refund the remaining items instead of voiding.",
  SALE_VOIDED: "This sale has been voided.",
  REASON_REQUIRED: "Add a reason. It's kept in the audit trail.",
  QTY_MUST_BE_WHOLE: "This item is sold in whole units.",
  INVALID_DISCOUNT: "Check the discount: percentages go up to 100 and amounts can't exceed the price.",
  EMPTY_CART: "Add at least one item.",
  VARIANT_NOT_FOUND: "One of the items is no longer in the catalogue. Refresh and try again.",
  VARIANT_INACTIVE: "One of the items has been archived.",
  LAST_OWNER: "Every business needs at least one active owner.",
  INVITATION_INVALID: "This invitation has expired or was sent to a different email address.",
  PO_NOT_EDITABLE: "Only draft purchase orders can be edited.",
  PO_NOT_RECEIVABLE: "Approve the purchase order before receiving stock against it.",
  INVALID_TRANSITION: "That step isn't available for this document's current status.",
  PAYMENT_EXCEEDS_BALANCE: (d) =>
    typeof d === "object" && d ? `The account balance is only ${formatMoney(d.balance as number)}.` : "Payment is more than the balance owed.",
  CANNOT_DISABLE_SELF: "You can't disable your own access.",
  RATE_LIMITED: "Too many businesses created today. Try again tomorrow.",
  QUOTATION_LOCKED: "Converted or cancelled quotations can't be changed.",
  SEQUENCE_CANNOT_DECREASE: "Invoice numbers can only move forward.",
};

export function describeError(raw: string, detail?: Detail): string {
  const code = raw.split(":")[0].trim();
  const m = messages[code];
  if (typeof m === "function") return m(detail);
  if (m) return m;
  if (/duplicate key value.*sku/i.test(raw)) return "That SKU is already used by another product.";
  if (/duplicate key value.*barcode/i.test(raw)) return "That barcode is already assigned to another product.";
  if (/duplicate key value/i.test(raw)) return "That name or code is already in use.";
  if (/row-level security|permission denied/i.test(raw)) return messages.PERMISSION_DENIED as string;
  if (/Failed to fetch|NetworkError|network/i.test(raw)) return "Can't reach the server. Check the connection and try again.";
  return raw;
}
