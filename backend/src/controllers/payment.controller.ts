/**
 * Square Payment Controller
 * Handles payment processing with Square API
 */

import { Request, Response } from "express";
import { randomUUID, createHash } from "crypto";
import { SquareError } from "square";
import squareClient, { squareConfig } from "../config/square.js";
import Order from "../models/Order.js";
import { sendSms } from "../utils/smsService.js";
import { sendInvoiceOrderConfirmation } from "../utils/mail.js";
import { sendOrderReceipt } from "../utils/emailService.js";

/**
 * Send a payment-confirmation/receipt email exactly once for an order, after a
 * Square payment completes. Without this, customers who paid via an SMS payment
 * link never received any email (the SMS only carried the link, and the webhook
 * marked the order paid without emailing). The atomic flag flip guards against
 * duplicate/repeated webhooks sending the email twice.
 */
const sendPaidConfirmationOnce = async (orderId: any): Promise<void> => {
  try {
    const order = await Order.findOneAndUpdate(
      { _id: orderId, paymentReceiptEmailSent: { $ne: true } },
      { $set: { paymentReceiptEmailSent: true } },
      { new: true },
    );
    if (!order || !order.clientInfo?.email) return;

    await sendOrderReceipt("full", {
      email: order.clientInfo.email,
      name: `${order.clientInfo.firstName} ${order.clientInfo.lastName}`.trim(),
      orderNumber: order.orderNumber,
      items: (order.items || []).map((it: any) => ({
        productName: it.productName,
        quantity: it.quantity,
        amount: it.amount ?? (it.unitPrice || 0) * (it.quantity || 1),
      })),
      subtotal: order.subtotal,
      taxAmount: order.taxAmount,
      deliveryFee: order.deliveryFee,
      total: order.total,
      paymentId: order.squarePaymentId || "square",
      orderDate: order.orderDate,
      pickupDate:
        order.pickupDate ||
        (order.deliveryDate ? new Date(order.deliveryDate) : undefined),
      pickupTimeSlot: order.deliveryTimeSlot || undefined,
      deliveryType: order.deliveryType,
      clientNote: order.notes,
      orderId: order._id.toString(),
    });
    console.log(
      `✅ [WEBHOOK] Payment confirmation email sent to ${order.clientInfo.email} (${order.orderNumber})`,
    );
  } catch (e: any) {
    console.error(
      "⚠️ [WEBHOOK] Failed to send payment confirmation email:",
      e?.message || e,
    );
  }
};

const isSquareUnauthorizedError = (statusCode?: number, errors?: any[]) => {
  if (statusCode === 401) return true;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (e) =>
      String(e?.code || "").toUpperCase() === "UNAUTHORIZED" ||
      String(e?.category || "").toUpperCase() === "AUTHENTICATION_ERROR",
  );
};

const squareUnauthorizedHint =
  "Square non autorise: verifier que SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID et SQUARE_ENVIRONMENT correspondent au MEME compte Square (sandbox vs production).";

const safeStringify = (value: unknown) =>
  JSON.stringify(value, (_, currentValue) =>
    typeof currentValue === "bigint" ? currentValue.toString() : currentValue,
  2);

const normalizeSquarePhoneNumber = (value?: string): string | null => {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) {
    return trimmed;
  }

  const digitsOnly = trimmed.replace(/\D/g, "");

  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }

  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return `+${digitsOnly}`;
  }

  return null;
};

const toBigIntAmount = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim() !== "") {
    return BigInt(value);
  }
  return 0n;
};

const getRefundableAmountCents = async (paymentId: string): Promise<bigint> => {
  const paymentResponse = await squareClient.payments.get({ paymentId });
  const payment = (paymentResponse as any)?.payment;

  const capturedAmount = toBigIntAmount(
    payment?.totalMoney?.amount ??
      payment?.amountMoney?.amount ??
      payment?.approvedMoney?.amount,
  );
  const refundedAmount = toBigIntAmount(payment?.refundedMoney?.amount);
  const refundable = capturedAmount - refundedAmount;

  return refundable > 0n ? refundable : 0n;
};

/**
 * Create a Square payment
 * POST /api/payments/create
 */
export const createPayment = async (req: Request, res: Response) => {
  const startTime = Date.now();
  console.log(
    `🔄 [PAYMENT] Starting payment creation for amount: ${req.body.amount} CAD`,
  );

  try {
    const { sourceId, amount, currency = "CAD", customerId, note } = req.body;

    // Validate required fields
    if (!sourceId || !amount) {
      console.error(
        `❌ [PAYMENT] Validation failed: sourceId and amount are required`,
      );
      return res.status(400).json({
        success: false,
        error: "sourceId and amount are required",
      });
    }

    // Log the sourceId for debugging (first/last 6 chars only)
    const sourceIdPreview =
      sourceId.length > 12
        ? `${sourceId.substring(0, 6)}...${sourceId.substring(sourceId.length - 6)}`
        : sourceId;
    console.log(
      `🔑 [PAYMENT] Source ID: ${sourceIdPreview} (length: ${sourceId.length})`,
    );
    console.log(
      `🏪 [PAYMENT] Location ID: ${squareConfig.locationId || "NOT SET"}`,
    );
    console.log(`🌐 [PAYMENT] Environment: ${squareConfig.environment}`);

    // Convert amount to cents (Square expects smallest currency unit)
    const amountInCents = Math.round(amount * 100);
    console.log(
      `💰 [PAYMENT] Processing payment for ${amount} CAD (${amountInCents} cents)`,
    );

    // Create idempotency key to prevent duplicate charges
    const idempotencyKey = randomUUID();
    console.log(`🔑 [PAYMENT] Generated idempotency key: ${idempotencyKey}`);

    // Create payment with Square (omit empty optional fields)
    const paymentRequest: any = {
      sourceId,
      idempotencyKey,
      amountMoney: {
        amount: BigInt(amountInCents),
        currency,
      },
      autocomplete: true, // Complete payment immediately
    };

    if (squareConfig.locationId) {
      paymentRequest.locationId = squareConfig.locationId;
    }

    if (customerId) {
      paymentRequest.customerId = customerId;
    }

    if (note) {
      paymentRequest.note = note;
    }

    const response = await squareClient.payments.create(paymentRequest);

    const payment = response.payment;
    const processingTime = Date.now() - startTime;

    // Square can return non-final states (PENDING, APPROVED, FAILED). Treat
    // anything other than COMPLETED as a failure so the order isn't marked paid.
    if (payment?.status !== "COMPLETED") {
      console.error(
        `❌ [PAYMENT] Non-final status returned by Square: ${payment?.status} (paymentId: ${payment?.id})`,
      );
      return res.status(502).json({
        success: false,
        error: `Paiement non complété (statut Square: ${payment?.status || "inconnu"})`,
        data: {
          paymentId: payment?.id,
          status: payment?.status,
        },
      });
    }

    console.log(
      `✅ [PAYMENT] Payment successful! ID: ${payment?.id}, Status: ${payment?.status}, Amount: ${payment?.amountMoney?.amount} cents, Processing time: ${processingTime}ms`,
    );

    res.json({
      success: true,
      data: {
        paymentId: payment?.id,
        status: payment?.status,
        amountMoney: {
          amount: payment?.amountMoney?.amount
            ? Number(payment.amountMoney.amount)
            : 0,
          currency: payment?.amountMoney?.currency,
        },
        receiptUrl: payment?.receiptUrl,
      },
    });
  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [PAYMENT] Payment failed after ${processingTime}ms`);

    // Handle Square SDK v44 errors (SquareError)
    if (error instanceof SquareError) {
      console.error(`🚨 [PAYMENT] SquareError status: ${error.statusCode}`);
      console.error(`🚨 [PAYMENT] SquareError message: ${error.message}`);
      console.error(
        `🚨 [PAYMENT] SquareError body:`,
        JSON.stringify(error.body, null, 2),
      );

      const squareErrors = (error.body as any)?.errors;
      if (squareErrors && Array.isArray(squareErrors)) {
        if (isSquareUnauthorizedError(error.statusCode, squareErrors)) {
          return res.status(401).json({
            success: false,
            error: squareUnauthorizedHint,
            details: squareErrors,
          });
        }

        const errorMessages = squareErrors
          .map(
            (e: any) =>
              `${e.category}: ${e.detail || e.code || "Unknown error"}${e.field ? ` (field: ${e.field})` : ""}`,
          )
          .join("; ");

        return res.status(error.statusCode || 400).json({
          success: false,
          error: errorMessages || "Payment validation failed",
          details: squareErrors,
        });
      }

      return res.status(error.statusCode || 400).json({
        success: false,
        error: error.message || "Square API error",
      });
    }

    // Handle legacy error format
    if (error?.statusCode) {
      console.error(`🚨 [PAYMENT] Square API status code:`, error.statusCode);
    }

    if (error?.body) {
      console.error(
        `🚨 [PAYMENT] Square API error body:`,
        JSON.stringify(error.body, null, 2),
      );
    }

    const squareErrors = error?.body?.errors || error?.errors;
    if (squareErrors && Array.isArray(squareErrors)) {
      if (isSquareUnauthorizedError(error?.statusCode, squareErrors)) {
        return res.status(401).json({
          success: false,
          error: squareUnauthorizedHint,
          details: squareErrors,
        });
      }

      console.error(
        `🚨 [PAYMENT] Square API errors:`,
        JSON.stringify(squareErrors, null, 2),
      );

      const errorMessages = squareErrors
        .map(
          (e: any) =>
            `${e.category}: ${e.detail || e.code || "Unknown error"}${e.field ? ` (field: ${e.field})` : ""}`,
        )
        .join("; ");

      return res.status(400).json({
        success: false,
        error: errorMessages || "Payment validation failed",
        details: squareErrors,
      });
    }

    console.error(
      `💥 [PAYMENT] Unexpected error during payment processing:`,
      error.message || error,
    );
    res.status(500).json({
      success: false,
      error: error.message || "An error occurred while processing payment",
    });
  }
};

/**
 * Get payment by ID
 * GET /api/payments/:paymentId
 */
export const getPayment = async (req: Request, res: Response) => {
  const { paymentId } = req.params;
  console.log(`🔍 [PAYMENT] Fetching payment details for ID: ${paymentId}`);

  try {
    // List payments and find the one with matching ID
    // Note: Single payment retrieval not directly supported in SDK
    const response = await squareClient.payments.list({
      locationId: squareConfig.locationId,
      sortField: "CREATED_AT",
      sortOrder: "DESC",
    });

    let payment = null;
    for await (const p of response) {
      if (p.id === paymentId) {
        payment = p;
        break;
      }
    }

    if (payment) {
      console.log(
        `✅ [PAYMENT] Payment found: ${paymentId}, Status: ${payment.status}`,
      );
    } else {
      console.log(`⚠️ [PAYMENT] Payment not found: ${paymentId}`);
    }

    res.json({
      success: true,
      data: payment,
    });
  } catch (error: any) {
    console.error(`❌ [PAYMENT] Error fetching payment ${paymentId}:`, error);

    res.status(500).json({
      success: false,
      error: "Failed to fetch payment",
    });
  }
};

/**
 * List payments with pagination
 * GET /api/payments/list
 */
export const listPayments = async (req: Request, res: Response) => {
  const { beginTime, endTime } = req.query;
  console.log(
    `📋 [PAYMENT] Listing payments${beginTime ? ` from ${beginTime}` : ""}${endTime ? ` to ${endTime}` : ""}`,
  );

  try {
    const response = await squareClient.payments.list({
      locationId: squareConfig.locationId,
      beginTime: beginTime as string,
      endTime: endTime as string,
      sortField: "CREATED_AT",
      sortOrder: "DESC",
    });

    const payments = [];
    for await (const payment of response) {
      payments.push({
        ...payment,
        amountMoney: payment.amountMoney
          ? {
              amount: Number(payment.amountMoney.amount),
              currency: payment.amountMoney.currency,
            }
          : undefined,
      });
    }

    console.log(`✅ [PAYMENT] Retrieved ${payments.length} payments`);

    res.json({
      success: true,
      data: {
        payments,
      },
    });
  } catch (error: any) {
    console.error(`❌ [PAYMENT] Error listing payments:`, error);

    res.status(500).json({
      success: false,
      error: "Failed to list payments",
    });
  }
};

/**
 * Refund a payment
 * POST /api/payments/refund
 */
export const refundPayment = async (req: Request, res: Response) => {
  const startTime = Date.now();
  console.log(`🔄 [REFUND] Starting refund process`);

  try {
    const { paymentId, amount, currency = "CAD", reason } = req.body;

    if (!paymentId || !amount) {
      console.error(
        `❌ [REFUND] Validation failed: paymentId and amount are required`,
      );
      return res.status(400).json({
        success: false,
        error: "paymentId and amount are required",
      });
    }

    const requestedAmountInCents = BigInt(Math.round(amount * 100));
    const refundableAmountInCents = await getRefundableAmountCents(paymentId);

    if (refundableAmountInCents <= 0n) {
      return res.status(400).json({
        success: false,
        error: "Ce paiement est deja totalement rembourse ou non remboursable",
      });
    }

    const amountInCents =
      requestedAmountInCents > refundableAmountInCents
        ? refundableAmountInCents
        : requestedAmountInCents;
    const idempotencyKey = randomUUID();

    console.log(
      `💸 [REFUND] Processing refund for payment ${paymentId}, requested: ${requestedAmountInCents} cents, final: ${amountInCents} cents, refundable: ${refundableAmountInCents} cents, reason: ${reason || "Not specified"}`,
    );

    const response = await squareClient.refunds.refundPayment({
      idempotencyKey,
      paymentId,
      amountMoney: {
        amount: BigInt(amountInCents),
        currency,
      },
      reason,
    });

    const refund = response.refund;
    const processingTime = Date.now() - startTime;

    // Accept COMPLETED (instant) and PENDING (async, will webhook back).
    // REJECTED/FAILED is a hard failure — don't mark the order refunded.
    if (refund?.status && !["COMPLETED", "PENDING"].includes(refund.status)) {
      console.error(
        `❌ [REFUND] Square returned terminal non-success status: ${refund.status} (refundId: ${refund.id})`,
      );
      return res.status(502).json({
        success: false,
        error: `Remboursement refusé par Square (statut: ${refund.status})`,
        data: { refundId: refund.id, status: refund.status },
      });
    }

    console.log(
      `✅ [REFUND] Refund successful! ID: ${refund?.id}, Status: ${refund?.status}, Amount: ${refund?.amountMoney?.amount} cents, Processing time: ${processingTime}ms`,
    );

    res.json({
      success: true,
      data: {
        refundId: refund?.id,
        status: refund?.status,
        amountMoney: refund?.amountMoney
          ? {
              amount: Number(refund.amountMoney.amount),
              currency: refund.amountMoney.currency,
            }
          : undefined,
        cappedToAvailableAmount: requestedAmountInCents !== amountInCents,
        requestedAmountCents: requestedAmountInCents,
        refundedAmountCents: amountInCents,
      },
    });
  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error(
      `❌ [REFUND] Refund failed after ${processingTime}ms:`,
      error,
    );

    if (error.errors) {
      console.error(`🚨 [REFUND] Square API errors:`, error.errors);
      return res.status(400).json({
        success: false,
        error: "Refund failed",
        details: error.errors,
      });
    }

    console.error(
      `💥 [REFUND] Unexpected error during refund processing:`,
      error.message,
    );
    res.status(500).json({
      success: false,
      error: "An error occurred while processing refund",
    });
  }
};

/**
 * Get Square configuration for frontend
 * GET /api/payments/config
 */
export const getSquareConfig = async (req: Request, res: Response) => {
  console.log(`⚙️ [CONFIG] Square configuration requested`);

  try {
    // Validate that required configuration exists
    if (!squareConfig.applicationId || !squareConfig.locationId) {
      console.error(
        `❌ [CONFIG] Missing required Square configuration:`,
        {
          hasApplicationId: !!squareConfig.applicationId,
          hasLocationId: !!squareConfig.locationId,
          applicationId: squareConfig.applicationId ? `${squareConfig.applicationId.substring(0, 10)}...` : 'MISSING',
          locationId: squareConfig.locationId ? `${squareConfig.locationId.substring(0, 10)}...` : 'MISSING',
        }
      );
      
      return res.status(500).json({
        success: false,
        error: "Square payment configuration is incomplete. Please check environment variables: SQUARE_APPLICATION_ID and SQUARE_LOCATION_ID",
      });
    }

    const config = {
      applicationId: squareConfig.applicationId,
      locationId: squareConfig.locationId,
      environment: squareConfig.environment,
    };

    console.log(
      `✅ [CONFIG] Square configuration provided for environment: ${config.environment}`,
      {
        applicationId: `${config.applicationId.substring(0, 10)}...`,
        locationId: `${config.locationId.substring(0, 10)}...`,
      }
    );

    res.json({
      success: true,
      data: config,
    });
  } catch (error: any) {
    console.error(`❌ [CONFIG] Error providing Square configuration:`, error);

    res.status(500).json({
      success: false,
      error: "Failed to load payment configuration",
    });
  }
};

/**
 * Create a Square invoice
 * POST /api/payments/invoice
 */
export const createInvoice = async (req: Request, res: Response) => {
  const startTime = Date.now();
  console.log(`🧾 [INVOICE] Creating Square invoice`);

  try {
    const {
      orderId,
      orderNumber,
      customerEmail,
      customerPhone,
      customerName,
      deliveryChannel = "email",
      items,
      deliveryFee = 0,
      taxAmount,
      total,
      dueDate,
      notes,
      deliveryType,
    } = req.body;

    // Validate required fields
    if (!orderId || !customerEmail || !customerName || !items || !total) {
      console.error(`❌ [INVOICE] Missing required fields`);
      return res.status(400).json({
        success: false,
        error: "orderId, customerEmail, customerName, items, and total are required",
      });
    }

    console.log(`📧 [INVOICE] Creating invoice for ${customerEmail} (Order: ${orderId})`);

    const normalizedPhone = normalizeSquarePhoneNumber(customerPhone);

    if (deliveryChannel === "sms" && !normalizedPhone) {
      return res.status(400).json({
        success: false,
        error: "Un numero de telephone valide est requis pour l'envoi par SMS",
      });
    }

    // Build line items for the invoice
    const lineItems = items.map((item: any) => ({
      name: item.name,
      quantity: item.quantity.toString(),
      itemType: "ITEM",
      basePriceMoney: {
        amount: BigInt(Math.round(item.unitPrice * 100)),
        currency: "CAD",
      },
    }));

    // Add tax as a line item (instead of using Square's tax system which applies to all items)
    if (taxAmount > 0) {
      lineItems.push({
        name: "TPS + TVQ",
        quantity: "1",
        itemType: "ITEM",
        basePriceMoney: {
          amount: BigInt(Math.round(taxAmount * 100)),
          currency: "CAD",
        },
      });
    }

    // Add delivery fee as a line item if applicable
    if (deliveryFee > 0) {
      lineItems.push({
        name: "Frais de livraison",
        quantity: "1",
        itemType: "ITEM",
        basePriceMoney: {
          amount: BigInt(Math.round(deliveryFee * 100)),
          currency: "CAD",
        },
      });
    }

    // Calculate due date (default to 7 days from now)
    const invoiceDueDate = dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const orderRequest: any = {
      idempotencyKey: randomUUID(),
      order: {
        locationId: squareConfig.locationId,
        referenceId: orderId,
        lineItems,
      },
    };

    const orderResponse = await squareClient.orders.create(orderRequest);
    const squareOrderId = (orderResponse as any)?.order?.id;

    if (!squareOrderId) {
      throw new Error("Creation de commande Square echouee: orderId manquant");
    }

    const customerResponse = await squareClient.customers.create({
      givenName: customerName.split(" ")[0] || customerName,
      familyName: customerName.split(" ").slice(1).join(" ") || undefined,
      emailAddress: customerEmail,
      // Only attach phone when actually delivering by SMS — Square rejects
      // borderline numbers with INVALID_PHONE_NUMBER otherwise.
      ...(deliveryChannel === "sms" && normalizedPhone
        ? { phoneNumber: normalizedPhone }
        : {}),
      referenceId: orderId,
    });

    const squareCustomerId = (customerResponse as any)?.customer?.id;

    if (!squareCustomerId) {
      throw new Error("Creation du client Square echouee: customerId manquant");
    }

    const invoiceRequest: any = {
      idempotencyKey: randomUUID(),
      invoice: {
        locationId: squareConfig.locationId,
        orderId: squareOrderId,
        // Unique invoice number per attempt (orderId + timestamp) — Square requires uniqueness per location
        invoiceNumber: `${orderId}-${Date.now()}`,
        title: `Commande ${orderNumber || orderId}`,
        description: notes || `Facture pour la commande ${orderNumber || orderId}`,
        primaryRecipient: {
          customerId: squareCustomerId,
        },
        paymentRequests: [
          {
            requestType: "BALANCE",
            dueDate: invoiceDueDate,
            automaticPaymentSource: "NONE",
          },
        ],
        deliveryMethod: "SHARE_MANUALLY",
        acceptedPaymentMethods: {
          card: true,
          squareGiftCard: false,
          bankAccount: false,
          buyNowPayLater: false,
        },
      },
    };

    const response = await squareClient.invoices.create(invoiceRequest);
    console.log(`📦 [INVOICE] Response structure:`, Object.keys(response));
    console.log(`📦 [INVOICE] Full response:`, safeStringify(response));
    const invoice = (response as any).invoice;
    const processingTime = Date.now() - startTime;

    console.log(
      `✅ [INVOICE] Invoice created successfully! ID: ${invoice?.id}, Number: ${invoice?.invoiceNumber}, Processing time: ${processingTime}ms`,
    );

    let notificationWarning: string | undefined;
    let publishedPublicUrl: string | undefined;

    // Publish the invoice to make it active and send through selected channel.
    if (invoice?.id) {
      try {
        console.log(`📤 [INVOICE] Publishing invoice ${invoice.id} (${deliveryChannel})...`);
        const publishResponse = await squareClient.invoices.publish({
          invoiceId: invoice.id,
          version: invoice.version!,
          idempotencyKey: randomUUID(),
        });

        publishedPublicUrl = (publishResponse as any)?.invoice?.publicUrl || invoice.publicUrl;

        if (deliveryChannel === "sms") {
          const publicUrl = publishedPublicUrl;
          if (!normalizedPhone || !publicUrl) {
            throw new Error("SMS impossible: numero client ou lien facture manquant");
          }

          await sendSms({
            to: normalizedPhone,
            body: `Marius et Fanny: votre lien de paiement pour la commande #${(orderNumber || orderId).split("-").pop()}: ${publicUrl}`,
          });
          console.log(`✅ [INVOICE] Invoice published and SMS sent`);
        } else {
          const publicUrl = publishedPublicUrl;
          if (!publicUrl) {
            throw new Error("Email impossible: lien facture manquant");
          }

          // Fetch order to get pickup/delivery date AND its real line items.
          const orderDoc = await Order.findById(orderId).lean().catch(() => null);
          const pickupDate = (orderDoc as any)?.pickupDate ? new Date((orderDoc as any).pickupDate) : undefined;
          const pickupTimeSlot = (orderDoc as any)?.pickupTimeSlot || (orderDoc as any)?.deliveryTimeSlot;
          const orderDeliveryType = (orderDoc as any)?.deliveryType || deliveryType;
          const orderClientNote = (orderDoc as any)?.notes;

          // Detect "balance-only" invoice: the caller built a synthetic single
          // line "Solde commande …" so Square charges exactly the balance.
          // For the EMAIL though, we want the customer to see their actual
          // products + a balance recap — otherwise the message just says
          // "Solde commande MF-…" which is useless for them. We rebuild the
          // item list from the order doc whenever we detect this pattern.
          const isBalanceInvoice =
            Array.isArray(items) &&
            items.length === 1 &&
            typeof items[0]?.name === "string" &&
            /^solde commande/i.test(items[0].name);

          const orderItems = ((orderDoc as any)?.items || []) as Array<any>;
          const emailItems = isBalanceInvoice && orderItems.length > 0
            ? orderItems.map((it: any) => ({
                productName:
                  it.productName ||
                  it.name ||
                  (it.productId ? `Produit #${it.productId}` : "Article"),
                quantity: it.quantity || 1,
                amount: it.amount || (it.unitPrice || 0) * (it.quantity || 1),
              }))
            : items.map((item: any) => ({
                productName: item.name,
                quantity: item.quantity,
                amount: item.unitPrice * item.quantity,
              }));

          // For balance emails, also show what's already paid and what's
          // still due so the recipient understands why the link is for less
          // than the order total.
          const orderTotal = isBalanceInvoice
            ? (orderDoc as any)?.total || total
            : total;
          const orderTaxes = isBalanceInvoice
            ? (orderDoc as any)?.taxAmount || taxAmount
            : taxAmount;
          const orderDelivery = isBalanceInvoice
            ? (orderDoc as any)?.deliveryFee || deliveryFee
            : deliveryFee;
          const orderSubtotal = orderTotal - orderTaxes - orderDelivery;

          const balanceNote = isBalanceInvoice
            ? `Solde restant à payer : ${total.toFixed(2)} $ (déjà payé : ${(orderTotal - total).toFixed(2)} $)`
            : (orderClientNote || "");

          await sendInvoiceOrderConfirmation(
            customerEmail,
            customerName,
            orderNumber || orderId,
            emailItems,
            orderSubtotal,
            orderTaxes,
            orderDelivery,
            orderTotal,
            publicUrl,
            new Date(),
            pickupDate,
            pickupTimeSlot,
            orderDeliveryType,
            balanceNote || orderClientNote,
            orderId,
          );
          console.log(`✅ [INVOICE] Invoice published and branded email sent${isBalanceInvoice ? " (balance-only)" : ""}`);
        }
      } catch (publishError: any) {
        console.error(`⚠️ [INVOICE] Failed to publish invoice:`, publishError.message);
        if (deliveryChannel === "sms") {
          notificationWarning =
            publishError?.message ||
            "Facture creee mais SMS non envoye (verifier configuration Twilio)";
          console.warn(`⚠️ [INVOICE] SMS warning: ${notificationWarning}`);
          // On ne bloque pas la creation de facture si l'envoi SMS echoue.
          // Cela permet d'utiliser le lien de paiement manuellement.
          if (publishedPublicUrl) {
            console.log(`🔗 [INVOICE] Payment link remains available: ${publishedPublicUrl}`);
          }
          
          // Optional fallback: send branded email when available
          if (customerEmail && publishedPublicUrl) {
            try {
              const orderDoc2 = await Order.findById(orderId).lean().catch(() => null);
              const pickupDate2 = (orderDoc2 as any)?.pickupDate ? new Date((orderDoc2 as any).pickupDate) : undefined;
              const pickupTimeSlot2 = (orderDoc2 as any)?.pickupTimeSlot || (orderDoc2 as any)?.deliveryTimeSlot;
              const orderDeliveryType2 = (orderDoc2 as any)?.deliveryType || deliveryType;
              const orderClientNote2 = (orderDoc2 as any)?.notes;
              await sendInvoiceOrderConfirmation(
                customerEmail,
                customerName,
                orderNumber || orderId,
                items.map((item: any) => ({
                  productName: item.name,
                  quantity: item.quantity,
                  amount: item.unitPrice * item.quantity,
                })),
                total - taxAmount - deliveryFee,
                taxAmount,
                deliveryFee,
                total,
                publishedPublicUrl,
                new Date(),
                pickupDate2,
                pickupTimeSlot2,
                orderDeliveryType2,
                orderClientNote2,
                orderId,
              );
              console.log(`✅ [INVOICE] Fallback email sent after SMS failure`);
            } catch (fallbackEmailError: any) {
              console.warn(
                `⚠️ [INVOICE] Fallback email also failed: ${fallbackEmailError?.message || fallbackEmailError}`,
              );
            }
          }
          
          // Continue normally
        } else {
          // Pour email, on continue même si la publication échoue - la facture est quand même créée
          notificationWarning =
            publishError?.message ||
            "Facture creee mais publication/envoi email incomplet";
        }
      }
    }

    res.json({
      success: true,
      data: {
        invoiceId: invoice?.id,
        invoiceNumber: invoice?.invoiceNumber,
        status: invoice?.status,
        publicUrl: publishedPublicUrl || invoice?.publicUrl,
        deliveryChannel,
        dueDate: invoice?.paymentRequests?.[0]?.dueDate,
        notificationWarning,
      },
    });
  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [INVOICE] Invoice creation failed after ${processingTime}ms`);
    console.error(`📋 [INVOICE] Error details:`, {
      message: error.message,
      statusCode: error.statusCode,
      errorCode: error.errorCode,
      body: error.body,
      response: error.response,
      fullError: error
    });

    if (error instanceof SquareError) {
      console.error(`🚨 [INVOICE] SquareError:`, error.body);
      const squareErrors = (error.body as any)?.errors;
      if (isSquareUnauthorizedError(error.statusCode, squareErrors)) {
        return res.status(401).json({
          success: false,
          error: squareUnauthorizedHint,
          details: squareErrors,
        });
      }

      // Square refuses customer phones from countries outside its supported
      // list (US/CA/UK/AU/IE/FR/ES/JP). Translate that error into something
      // the admin can act on instead of dumping the raw Square JSON.
      const isInvalidPhone =
        Array.isArray(squareErrors) &&
        squareErrors.some((e: any) => e?.code === "INVALID_PHONE_NUMBER");
      if (isInvalidPhone) {
        return res.status(400).json({
          success: false,
          error:
            "Numéro de téléphone non supporté par Square pour ce pays. Utilisez plutôt l'envoi par email.",
          details: squareErrors,
        });
      }

      return res.status(error.statusCode || 400).json({
        success: false,
        error: error.message || "Failed to create invoice",
        details: squareErrors,
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || "An error occurred while creating invoice",
    });
  }
};

const findSquarePaymentIdForOrder = async (order: any): Promise<string | null> => {
  if (order.squarePaymentId) return order.squarePaymentId;

  if (!order.squareInvoiceId) return null;

  const invoiceResponse = await squareClient.invoices.get({
    invoiceId: order.squareInvoiceId,
  });
  const squareOrderId = (invoiceResponse as any)?.invoice?.orderId;

  if (!squareOrderId) return null;

  // sortField/sortOrder are required by Square's API — omitting them ships
  // an empty string and triggers INVALID_ENUM_VALUE on sort_field, which
  // surfaces in the admin as "Erreur lors du remboursement: 400".
  const payments = await squareClient.payments.list({
    locationId: squareConfig.locationId,
    sortField: "CREATED_AT",
    sortOrder: "DESC",
  });

  let matchedPaymentId: string | null = null;
  for await (const payment of payments) {
    if (payment.orderId === squareOrderId && payment.status === "COMPLETED") {
      matchedPaymentId = payment.id || null;
      break;
    }
  }

  return matchedPaymentId;
};

/**
 * Refund an order through Square, preferring direct paymentId then invoice-linked payment.
 * POST /api/payments/refund-order
 */
export const refundOrderPayment = async (req: Request, res: Response) => {
  try {
    const { orderId, reason, employeeName } = req.body as {
      orderId: string;
      reason?: string;
      employeeName?: string;
    };

    if (!employeeName || !employeeName.trim()) {
      return res.status(400).json({
        success: false,
        error: "Le nom de l'employe est obligatoire pour effectuer un remboursement",
      });
    }

    const employeeId = req.user?.id;
    const employeeLabel = `${employeeName.trim()} (ID: ${employeeId ?? "inconnu"})`;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: "Commande non trouvee" });
    }

    const paymentId = await findSquarePaymentIdForOrder(order);
    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: "Aucun paiement Square remboursable trouve pour cette commande",
      });
    }

    // If we resolved the paymentId via the (slow) invoice fallback, persist it
    // on the order so future refunds/lookups are instant and reliable instead
    // of re-scanning every Square payment each time.
    if (!order.squarePaymentId) {
      order.squarePaymentId = paymentId;
    }

    // Block only if THIS specific Square payment was already refunded — NOT if
    // the order merely has an older refund. Supported flow (Fanny's case):
    //   pay → refund → modify order → re-pay (NEW Square payment) → refund again
    // must still work, because the re-payment is a different paymentId.
    // A double-click on the SAME payment is caught here; the idempotency key
    // below is the authoritative second line of defense. A previously FAILED
    // refund (status not COMPLETED/PENDING) stays retryable.
    const thisPaymentAlreadyRefunded =
      Array.isArray((order as any).refunds) &&
      (order as any).refunds.some(
        (r: any) =>
          r.paymentId === paymentId &&
          (!r.refundStatus || ["COMPLETED", "PENDING"].includes(r.refundStatus)),
      );
    if (thisPaymentAlreadyRefunded) {
      return res.status(400).json({
        success: false,
        error: "Ce paiement a deja ete rembourse",
      });
    }

    const requestedAmountInCents = BigInt(Math.round(order.total * 100));
    const refundableAmountInCents = await getRefundableAmountCents(paymentId);

    if (refundableAmountInCents <= 0n) {
      return res.status(400).json({
        success: false,
        error: "Ce paiement est deja totalement rembourse ou non remboursable",
      });
    }

    const refundAmountInCents =
      requestedAmountInCents > refundableAmountInCents
        ? refundableAmountInCents
        : requestedAmountInCents;

    // Deterministic idempotency key tied to the SPECIFIC payment + amount:
    //  - retry / double-click on the SAME payment → same key → Square returns
    //    the original refund (no double refund).
    //  - a DIFFERENT payment (order modified then re-paid) → different key →
    //    the new refund goes through normally.
    // Hashed so it always fits Square's 45-char limit regardless of id length.
    const idempotencyKey = createHash("sha256")
      .update(`refund-${paymentId}-${refundAmountInCents.toString()}`)
      .digest("hex")
      .slice(0, 40);

    const refundResponse = await squareClient.refunds.refundPayment({
      idempotencyKey,
      paymentId,
      amountMoney: {
        amount: refundAmountInCents,
        currency: "CAD",
      },
      reason: reason || `Remboursement commande ${order.orderNumber}`,
    });

    const refund = refundResponse?.refund;

    // Don't cancel the order if Square rejected the refund.
    if (refund?.status && !["COMPLETED", "PENDING"].includes(refund.status)) {
      return res.status(502).json({
        success: false,
        error: `Remboursement refusé par Square (statut: ${refund.status})`,
        data: { orderId: String(order._id), refundId: refund.id, status: refund.status },
      });
    }

    order.status = "cancelled";
    order.paymentStatus = "unpaid";
    order.balancePaid = false;
    order.balancePaidAt = undefined;
    order.notes = `${order.notes ? `${order.notes}\n` : ""}Square Refund ID: ${refund?.id || "N/A"}`;
    (order as any).refunds = [
      ...(((order as any).refunds as any[]) || []),
      {
        refundedAt: new Date(),
        employeeName: employeeName.trim(),
        employeeId: employeeId || undefined,
        paymentId,
        refundId: refund?.id || undefined,
        refundStatus: refund?.status || undefined,
        amountCents: Number(refundAmountInCents),
        reason: reason || `Remboursement commande ${order.orderNumber}`,
      },
    ];
    order.changeHistory.push({
      changedAt: new Date(),
      changedBy: employeeId,
      field: "paymentStatus",
      oldValue: "paid",
      newValue: "unpaid",
      changeType: "payment_updated",
      notes: `Square refund executed by ${employeeLabel} (paymentId: ${paymentId}, refundId: ${refund?.id || "N/A"})`,
    } as any);
    await order.save();

    return res.json({
      success: true,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        paymentId,
        refundId: refund?.id,
        refundStatus: refund?.status,
        refundAmountCents: Number(refundAmountInCents),
        cappedToAvailableAmount: requestedAmountInCents !== refundAmountInCents,
        refundEntry:
          (order as any).refunds && (order as any).refunds.length > 0
            ? (order as any).refunds[(order as any).refunds.length - 1]
            : undefined,
      },
      message: "Remboursement Square effectue avec succes",
    });
  } catch (error: any) {
    console.error("❌ [REFUND-ORDER] Error refunding order:", error);

    if (error instanceof SquareError) {
      return res.status(error.statusCode || 400).json({
        success: false,
        error: error.message || "Erreur Square lors du remboursement",
        details: (error.body as any)?.errors,
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message || "Erreur lors du remboursement de la commande",
    });
  }
};

/**
 * Reconcile an order's payment/refund status against Square's source of truth.
 * Fixes orders that were refunded on Square but still show "Payé" in the app —
 * e.g. a refund that completed before the webhook fix, or a missed webhook.
 * Reads Square's refundedMoney for the payment and updates the order to match.
 * POST /api/payments/reconcile-refund
 */
export const reconcileOrderRefund = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.body as { orderId: string };

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: "Commande non trouvee" });
    }

    const paymentId = await findSquarePaymentIdForOrder(order);
    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: "Aucun paiement Square trouve pour cette commande",
      });
    }
    if (!order.squarePaymentId) order.squarePaymentId = paymentId;

    // Ask Square how much of this payment has actually been refunded.
    const paymentResponse = await squareClient.payments.get({ paymentId });
    const payment = (paymentResponse as any)?.payment;
    const refundedCents = Number(payment?.refundedMoney?.amount || 0);
    const refundedDollars = refundedCents / 100;
    const total = order.total || 0;

    if (refundedCents <= 0) {
      return res.json({
        success: true,
        changed: false,
        message: "Aucun remboursement trouve sur Square pour ce paiement.",
        data: { orderId: String(order._id), paymentStatus: order.paymentStatus },
      });
    }

    // A refund exists on Square — make the order reflect it.
    const refunds = (((order as any).refunds as any[]) || []).slice();
    if (refunds.length === 0) {
      refunds.push({
        refundedAt: new Date(),
        employeeName: "Synchronisation Square",
        paymentId,
        refundStatus: "completed",
        amountCents: refundedCents,
        reason: "Remboursement synchronise depuis Square",
      });
    } else {
      // Finalize any entries still marked pending.
      for (const r of refunds) {
        if (!r.refundStatus || String(r.refundStatus).toLowerCase() !== "completed") {
          r.refundStatus = "completed";
        }
      }
    }
    (order as any).refunds = refunds;
    order.markModified("refunds");

    order.amountPaid = Math.max(0, total - refundedDollars);
    if (order.amountPaid < 0.01) {
      order.status = "cancelled";
      order.paymentStatus = "unpaid";
      order.depositPaid = false;
      order.balancePaid = false;
    }
    await order.save();

    return res.json({
      success: true,
      changed: true,
      message: "Statut de remboursement synchronise depuis Square.",
      data: {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        refundedDollars,
        paymentStatus: order.paymentStatus,
        status: order.status,
      },
    });
  } catch (error: any) {
    console.error("❌ [RECONCILE] Error reconciling refund:", error);
    if (error instanceof SquareError) {
      return res.status(error.statusCode || 400).json({
        success: false,
        error: error.message || "Erreur Square lors de la synchronisation",
      });
    }
    return res.status(500).json({
      success: false,
      error: error.message || "Erreur lors de la synchronisation du remboursement",
    });
  }
};

/**
 * Resend the FACTURE/receipt email for an order — with NO payment link, so it's
 * safe even for already-paid orders (no double-payment risk). Government orders
 * go to the billing email (the city); everyone else gets it at the client's
 * email. Used by the "Renvoyer la facture" button.
 * POST /api/payments/resend-facture
 */
export const resendFacture = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.body as { orderId: string };
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: "Commande non trouvee" });
    }
    const isGov = order.billingKind === "gouvernement";
    const dest = (
      isGov ? order.billingEmail || "" : order.clientInfo?.email || ""
    ).trim();
    if (!dest) {
      return res.status(400).json({
        success: false,
        error: isGov
          ? "Aucun courriel de facturation (ville) n'est défini sur cette commande."
          : "Aucun courriel client sur cette commande.",
      });
    }

    await sendInvoiceOrderConfirmation(
      dest,
      `${order.clientInfo.firstName} ${order.clientInfo.lastName}`.trim(),
      order.orderNumber,
      (order.items || []).map((it: any) => ({
        productName: it.productName,
        quantity: it.quantity,
        amount: it.amount ?? (it.unitPrice || 0) * (it.quantity || 1),
      })),
      order.subtotal,
      order.taxAmount,
      order.deliveryFee,
      order.total,
      undefined,
      order.orderDate,
      order.pickupDate ||
        (order.deliveryDate ? new Date(order.deliveryDate) : undefined),
      order.deliveryTimeSlot || undefined,
      order.deliveryType,
      order.notes,
      order._id.toString(),
      true,  // asFacture
      false, // hideBreakdown
      order.billingOrganization || undefined, // organization on the facture
    );

    res.json({ success: true, data: { email: dest } });
  } catch (error: any) {
    console.error("❌ [RESEND-FACTURE] Error:", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Erreur lors de l'envoi de la facture",
    });
  }
};

/**
 * Record an in-store refund (cash / debit returned at the counter).
 * No Square call — this is purely bookkeeping.
 * POST /api/payments/refund-order-in-store
 */
export const refundOrderInStore = async (req: Request, res: Response) => {
  try {
    const { orderId, employeeName, amount, reason } = req.body as {
      orderId?: string;
      employeeName?: string;
      amount?: number;
      reason?: string;
    };

    if (!orderId || !employeeName || !employeeName.trim()) {
      return res.status(400).json({
        success: false,
        error: "orderId et employeeName sont requis",
      });
    }

    const employeeId = req.user?.id;
    const employeeLabel = `${employeeName.trim()} (ID: ${employeeId ?? "inconnu"})`;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: "Commande non trouvee" });
    }

    // Only in-store-paid orders should use this path; orders with a Square
    // payment must go through refundOrderPayment so Square actually refunds.
    if (order.squarePaymentId || order.squareInvoiceId) {
      return res.status(400).json({
        success: false,
        error:
          "Cette commande a un paiement Square — utiliser le remboursement Square plutot",
      });
    }

    const alreadyRefunded =
      Array.isArray((order as any).refunds) && (order as any).refunds.length > 0;
    if (alreadyRefunded) {
      return res.status(400).json({
        success: false,
        error: "Cette commande a deja une entree de remboursement",
      });
    }

    const refundAmount =
      typeof amount === "number" && amount > 0 ? amount : order.total;
    const refundAmountCents = Math.round(refundAmount * 100);
    const finalReason = reason?.trim() || `Remboursement en magasin (commande ${order.orderNumber})`;

    order.status = "cancelled";
    order.paymentStatus = "unpaid";
    order.balancePaid = false;
    order.balancePaidAt = undefined;
    (order as any).refunds = [
      ...(((order as any).refunds as any[]) || []),
      {
        refundedAt: new Date(),
        employeeName: employeeName.trim(),
        employeeId: employeeId || undefined,
        // paymentId intentionally omitted — flags this as an in-store refund
        amountCents: refundAmountCents,
        reason: finalReason,
      },
    ];
    order.changeHistory.push({
      changedAt: new Date(),
      changedBy: employeeId,
      field: "paymentStatus",
      oldValue: "paid",
      newValue: "unpaid",
      changeType: "payment_updated",
      notes: `In-store refund recorded by ${employeeLabel} (${refundAmount.toFixed(2)}$)`,
    } as any);
    await order.save();

    return res.json({
      success: true,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        refundAmountCents,
        refundEntry:
          (order as any).refunds && (order as any).refunds.length > 0
            ? (order as any).refunds[(order as any).refunds.length - 1]
            : undefined,
      },
      message: "Remboursement en magasin enregistre",
    });
  } catch (error: any) {
    console.error("❌ [REFUND-IN-STORE] Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Erreur lors de l'enregistrement du remboursement",
    });
  }
};

/**
 * Partial refund for balance difference (order modification)
 * POST /api/payments/refund-balance
 */
export const refundBalance = async (req: Request, res: Response) => {
  try {
    const { orderId, amount, employeeName } = req.body as {
      orderId: string;
      amount: number;
      employeeName: string;
    };

    if (!employeeName?.trim()) {
      return res.status(400).json({
        success: false,
        error: "Le nom de l'employé est obligatoire",
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Le montant du remboursement doit être positif",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: "Commande non trouvée" });
    }

    const paymentId = await findSquarePaymentIdForOrder(order);
    if (!paymentId) {
      return res.status(400).json({
        success: false,
        error: "Aucun paiement Square trouvé pour cette commande. Remboursement manuel requis.",
      });
    }

    const refundAmountInCents = BigInt(Math.round(amount * 100));
    const refundableAmountInCents = await getRefundableAmountCents(paymentId);

    if (refundableAmountInCents <= 0n) {
      return res.status(400).json({
        success: false,
        error: "Ce paiement est déjà totalement remboursé",
      });
    }

    const actualRefundCents = refundAmountInCents > refundableAmountInCents
      ? refundableAmountInCents
      : refundAmountInCents;

    const employeeId = req.user?.id;
    const refundResponse = await squareClient.refunds.refundPayment({
      idempotencyKey: randomUUID(),
      paymentId,
      amountMoney: {
        amount: actualRefundCents,
        currency: "CAD",
      },
      reason: `Remboursement partiel (modification commande ${order.orderNumber}) par ${employeeName.trim()}`,
    });

    const refund = refundResponse?.refund;

    // Don't update the order if Square rejected the refund.
    if (refund?.status && !["COMPLETED", "PENDING"].includes(refund.status)) {
      return res.status(502).json({
        success: false,
        error: `Remboursement refusé par Square (statut: ${refund.status})`,
        data: { orderId: String(order._id), refundId: refund.id, status: refund.status },
      });
    }

    // Update amountPaid to match new total
    order.amountPaid = order.total;

    // Add refund to history
    (order as any).refunds = [
      ...(((order as any).refunds as any[]) || []),
      {
        refundedAt: new Date(),
        employeeName: employeeName.trim(),
        employeeId: employeeId || undefined,
        paymentId,
        refundId: refund?.id || undefined,
        refundStatus: refund?.status || undefined,
        amountCents: Number(actualRefundCents),
        reason: `Remboursement partiel (modification commande)`,
      },
    ];

    order.changeHistory.push({
      changedAt: new Date(),
      changedBy: employeeId,
      field: "paymentStatus",
      oldValue: order.paymentStatus,
      newValue: order.paymentStatus,
      changeType: "payment_updated",
      notes: `Partial refund of ${(Number(actualRefundCents) / 100).toFixed(2)}$ by ${employeeName.trim()} (refundId: ${refund?.id || "N/A"})`,
    } as any);

    await order.save();

    console.log(`✅ Partial refund of ${(Number(actualRefundCents) / 100).toFixed(2)}$ for order ${order.orderNumber}`);

    return res.json({
      success: true,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        refundId: refund?.id,
        refundStatus: refund?.status,
        refundAmountCents: Number(actualRefundCents),
        amountPaid: order.amountPaid,
      },
      message: "Remboursement partiel effectué avec succès",
    });
  } catch (error: any) {
    console.error("❌ [REFUND-BALANCE] Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Erreur lors du remboursement partiel",
    });
  }
};

/**
 * Get a Square invoice by ID
 * GET /api/payments/invoice/:invoiceId
 */
export const getInvoice = async (req: Request, res: Response) => {
  const { invoiceId } = req.params;
  const invoiceIdStr = Array.isArray(invoiceId) ? invoiceId[0] : invoiceId;
  console.log(`🔍 [INVOICE] Fetching invoice: ${invoiceIdStr}`);

  try {
    const response = await squareClient.invoices.get({
      invoiceId: invoiceIdStr,
    });
    const invoice = (response as any).invoice;

    console.log(
      `✅ [INVOICE] Invoice retrieved: ${invoiceId}, Status: ${invoice?.status}`,
    );

    res.json({
      success: true,
      data: invoice,
    });
  } catch (error: any) {
    console.error(`❌ [INVOICE] Error fetching invoice ${invoiceId}:`, error);

    if (error instanceof SquareError) {
      return res.status(error.statusCode || 404).json({
        success: false,
        error: error.message || "Invoice not found",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to fetch invoice",
    });
  }
};

/**
 * Cancel a Square invoice (used when an order is cancelled but the invoice
 * was sent and not yet paid).
 * POST /api/payments/cancel-invoice
 */
export const cancelInvoice = async (req: Request, res: Response) => {
  try {
    const { orderId, invoiceId } = req.body as { orderId?: string; invoiceId?: string };

    let targetInvoiceId = invoiceId;
    if (!targetInvoiceId && orderId) {
      const order = await Order.findById(orderId);
      targetInvoiceId = order?.squareInvoiceId;
    }

    if (!targetInvoiceId) {
      return res.status(400).json({
        success: false,
        error: "Aucun ID de facture Square fourni",
      });
    }

    // Fetch invoice to get current version
    const getResp = await squareClient.invoices.get({ invoiceId: targetInvoiceId });
    const invoice = (getResp as any)?.invoice;
    if (!invoice) {
      return res.status(404).json({ success: false, error: "Facture Square introuvable" });
    }

    // If already cancelled or paid, skip
    if (invoice.status === "CANCELED" || invoice.status === "PAID") {
      return res.json({ success: true, data: { status: invoice.status, alreadyHandled: true } });
    }

    // Cancel via Square
    const cancelResp = await squareClient.invoices.cancel({
      invoiceId: targetInvoiceId,
      version: invoice.version!,
    });

    console.log(`✅ [INVOICE] Cancelled Square invoice ${targetInvoiceId}`);
    res.json({ success: true, data: cancelResp });
  } catch (error: any) {
    console.error("❌ [INVOICE] Failed to cancel Square invoice:", error?.message || error);
    res.status(500).json({
      success: false,
      error: error?.message || "Échec de l'annulation de la facture Square",
    });
  }
};

/**
 * Square Webhook handler
 * POST /api/payments/webhook
 *
 * Handles invoice.payment_made and payment.completed events.
 * When a customer pays via a Square payment link/invoice, this endpoint
 * updates the corresponding order's payment status to "paid".
 */
export const squareWebhook = async (req: Request, res: Response) => {
  try {
    const event = req.body;
    const eventType = event?.type;

    console.log(`🔔 [WEBHOOK] Received Square event: ${eventType}`);

    if (eventType === "invoice.payment_made" || eventType === "invoice.updated") {
      const invoice = event?.data?.object?.invoice;
      const invoiceId = invoice?.id;
      const invoiceStatus = invoice?.status;

      console.log(`🧾 [WEBHOOK] Invoice ${invoiceId} status: ${invoiceStatus}`);

      if (invoiceStatus === "PAID" && invoiceId) {
        // Find the order with this Square invoice ID
        const order = await Order.findOne({ squareInvoiceId: invoiceId });

        if (order) {
          // Guard: a late/duplicate payment webhook must NOT resurrect an order
          // that was already refunded or cancelled (otherwise a refund issued
          // moments after payment gets overwritten back to "paid").
          if (order.status === "cancelled" || ((order as any).refunds?.length > 0)) {
            console.log(`⏭️ [WEBHOOK] Order ${order.orderNumber} already refunded/cancelled — NOT re-marking paid (invoice: ${invoiceId})`);
          } else {
            const total = order.total || 0;
            order.paymentStatus = "paid";
            order.depositPaid = true;
            order.balancePaid = true;
            order.amountPaid = total;
            order.depositPaidAt = order.depositPaidAt || new Date();
            order.balancePaidAt = new Date();

            await order.save();
            console.log(`✅ [WEBHOOK] Order ${order.orderNumber} marked as PAID (invoice: ${invoiceId})`);
            // Email a payment confirmation/receipt (covers SMS-link payers who
            // otherwise never get any email). Idempotent — sent at most once.
            await sendPaidConfirmationOnce(order._id);
          }
        } else {
          console.warn(`⚠️ [WEBHOOK] No order found for invoice ${invoiceId}`);
        }
      }
    }

    if (eventType === "payment.completed" || eventType === "payment.updated") {
      const payment = event?.data?.object?.payment;
      const paymentId = payment?.id;
      const paymentStatus = payment?.status;

      console.log(`💳 [WEBHOOK] Payment ${paymentId} status: ${paymentStatus}`);

      if (paymentStatus === "COMPLETED" && paymentId) {
        const order = await Order.findOne({ squarePaymentId: paymentId });

        if (order) {
          // Guard: see invoice block above — never resurrect a refunded/cancelled
          // order from a late or duplicate payment webhook.
          if (order.status === "cancelled" || ((order as any).refunds?.length > 0)) {
            console.log(`⏭️ [WEBHOOK] Order ${order.orderNumber} already refunded/cancelled — NOT re-marking paid (payment: ${paymentId})`);
          } else {
            const total = order.total || 0;
            order.paymentStatus = "paid";
            order.depositPaid = true;
            order.balancePaid = true;
            order.amountPaid = total;
            order.depositPaidAt = order.depositPaidAt || new Date();
            order.balancePaidAt = new Date();

            await order.save();
            console.log(`✅ [WEBHOOK] Order ${order.orderNumber} marked as PAID (payment: ${paymentId})`);
            await sendPaidConfirmationOnce(order._id);
          }
        }
      }
    }

    // Refunds initiated from Square dashboard
    if (eventType === "refund.created" || eventType === "refund.updated") {
      const refund = event?.data?.object?.refund;
      const refundId = refund?.id;
      const refundStatus = refund?.status;
      const paymentId = refund?.payment_id || refund?.paymentId;
      const amountMoney = refund?.amount_money || refund?.amountMoney;
      const refundAmountCents = Number(amountMoney?.amount || 0);

      console.log(`↩️ [WEBHOOK] Refund ${refundId} status: ${refundStatus}, payment: ${paymentId}, amount: ${refundAmountCents}`);

      if (refundStatus === "COMPLETED" && paymentId && refundAmountCents > 0) {
        const order = await Order.findOne({ squarePaymentId: paymentId });

        if (order) {
          const existingRefunds = ((order as any).refunds || []) as any[];
          const existing = existingRefunds.find((r) => r.refundId === refundId);

          // Upsert the refund entry and mark it completed. If our own refund
          // endpoint already recorded it (likely still PENDING), DON'T skip —
          // finalize it so the order reflects a completed refund.
          const updatedRefunds = existing
            ? existingRefunds.map((r) =>
                r.refundId === refundId ? { ...r, refundStatus: "completed" } : r,
              )
            : [
                ...existingRefunds,
                {
                  refundedAt: new Date(),
                  employeeName: "Square Dashboard",
                  paymentId,
                  refundId,
                  refundStatus: "completed",
                  amountCents: refundAmountCents,
                  reason: "Remboursement via Square Dashboard",
                },
              ];
          (order as any).refunds = updatedRefunds;
          order.markModified("refunds");

          // Recompute amountPaid from total MINUS all completed refunds. Using an
          // absolute recomputation (not subtraction) keeps this idempotent across
          // repeated/duplicate webhooks — no double-counting.
          const total = order.total || 0;
          const totalRefundedDollars = updatedRefunds
            .filter((r) => String(r.refundStatus || "").toLowerCase() === "completed")
            .reduce((s, r) => s + (Number(r.amountCents) || 0) / 100, 0);
          order.amountPaid = Math.max(0, total - totalRefundedDollars);

          // If fully refunded, mark order as cancelled + unpaid.
          if (order.amountPaid < 0.01) {
            order.status = "cancelled";
            order.paymentStatus = "unpaid";
            order.depositPaid = false;
            order.balancePaid = false;
          }

          await order.save();
          console.log(`✅ [WEBHOOK] Refund ${refundId} finalized for order ${order.orderNumber} (amountPaid=${order.amountPaid})`);
        }
      }
    }

    // Always respond 200 to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error("❌ [WEBHOOK] Error processing webhook:", error.message || error);
    // Still respond 200 to avoid Square retrying
    res.status(200).json({ received: true });
  }
};

/**
 * Server-side helper: build a Square invoice for an existing Order, publish it,
 * and notify the customer via the chosen channel. Used by both the public
 * Quote-acceptance flow and any other place that needs to issue a payment
 * link without going through the HTTP createInvoice endpoint.
 */
export async function createInvoiceForExistingOrder(
  orderId: string,
  channel: "email" | "sms" = "email",
): Promise<{ invoiceId: string | null; publicUrl: string | null }> {
  // Pre-flight checks so we surface a clear reason instead of a Square SDK
  // stack trace 50 lines down.
  if (!squareConfig.locationId) {
    throw new Error(
      "SQUARE_LOCATION_ID manquant côté serveur — impossible d'émettre la facture",
    );
  }

  const order = await Order.findById(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const customerEmail = order.clientInfo.email;
  const customerName = `${order.clientInfo.firstName} ${order.clientInfo.lastName}`.trim();
  const customerPhone = order.clientInfo.phone;
  const orderNumber = order.orderNumber;
  const total = order.total;
  const taxAmount = order.taxAmount || 0;
  const deliveryFee = order.deliveryFee || 0;
  const items = order.items.map((it) => ({
    name: it.productName,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
  }));

  if (!customerEmail) {
    throw new Error("Email client manquant sur la commande");
  }
  const normalizedPhone = normalizeSquarePhoneNumber(customerPhone);
  if (channel === "sms" && !normalizedPhone) {
    throw new Error("Numero de telephone valide requis pour l'envoi SMS");
  }
  // Only attach the phone to the Square customer when we actually need it
  // (SMS delivery). Email channel doesn't need a phone, and Square is strict
  // about phone format so passing a borderline number causes
  // INVALID_PHONE_NUMBER errors.
  const phoneForSquare = channel === "sms" ? normalizedPhone : null;

  const lineItems: any[] = items.map((item) => ({
    name: item.name,
    quantity: item.quantity.toString(),
    itemType: "ITEM",
    basePriceMoney: {
      amount: BigInt(Math.round(item.unitPrice * 100)),
      currency: "CAD",
    },
  }));
  if (taxAmount > 0) {
    lineItems.push({
      name: "TPS + TVQ",
      quantity: "1",
      itemType: "ITEM",
      basePriceMoney: { amount: BigInt(Math.round(taxAmount * 100)), currency: "CAD" },
    });
  }
  if (deliveryFee > 0) {
    lineItems.push({
      name: "Frais de livraison",
      quantity: "1",
      itemType: "ITEM",
      basePriceMoney: { amount: BigInt(Math.round(deliveryFee * 100)), currency: "CAD" },
    });
  }

  const invoiceDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const orderResp = await squareClient.orders.create({
    idempotencyKey: randomUUID(),
    order: {
      locationId: squareConfig.locationId,
      referenceId: orderId,
      lineItems,
    },
  });
  const squareOrderId = (orderResp as any)?.order?.id;
  if (!squareOrderId) throw new Error("Square order id missing");

  const customerResp = await squareClient.customers.create({
    givenName: customerName.split(" ")[0] || customerName,
    familyName: customerName.split(" ").slice(1).join(" ") || undefined,
    emailAddress: customerEmail,
    ...(phoneForSquare ? { phoneNumber: phoneForSquare } : {}),
    referenceId: orderId,
  });
  const squareCustomerId = (customerResp as any)?.customer?.id;
  if (!squareCustomerId) throw new Error("Square customer id missing");

  const invoiceResp = await squareClient.invoices.create({
    idempotencyKey: randomUUID(),
    invoice: {
      locationId: squareConfig.locationId,
      orderId: squareOrderId,
      invoiceNumber: `${orderId}-${Date.now()}`,
      title: `Commande ${orderNumber}`,
      description: `Facture pour la commande ${orderNumber}`,
      primaryRecipient: { customerId: squareCustomerId },
      paymentRequests: [
        { requestType: "BALANCE", dueDate: invoiceDueDate, automaticPaymentSource: "NONE" },
      ],
      deliveryMethod: "SHARE_MANUALLY",
      acceptedPaymentMethods: {
        card: true,
        squareGiftCard: false,
        bankAccount: false,
        buyNowPayLater: false,
      },
    },
  });
  const invoice = (invoiceResp as any)?.invoice;
  if (!invoice?.id) throw new Error("Invoice id missing after create");

  const publishResp = await squareClient.invoices.publish({
    invoiceId: invoice.id,
    version: invoice.version!,
    idempotencyKey: randomUUID(),
  });
  const publicUrl =
    (publishResp as any)?.invoice?.publicUrl || invoice.publicUrl || null;

  if (!publicUrl) throw new Error("Public invoice URL missing after publish");

  if (channel === "sms") {
    await sendSms({
      to: normalizedPhone!,
      body: `Marius et Fanny: votre lien de paiement pour la commande #${(orderNumber || orderId).split("-").pop()}: ${publicUrl}`,
    });
  } else {
    const pickupDate = order.pickupDate ? new Date(order.pickupDate) : undefined;
    await sendInvoiceOrderConfirmation(
      customerEmail,
      customerName,
      orderNumber,
      items.map((item) => ({
        productName: item.name,
        quantity: item.quantity,
        amount: item.unitPrice * item.quantity,
      })),
      total - taxAmount - deliveryFee,
      taxAmount,
      deliveryFee,
      total,
      publicUrl,
      new Date(),
      pickupDate,
      order.deliveryTimeSlot,
      order.deliveryType,
      order.notes,
      orderId,
    );
  }

  // Persist the invoice id so the dashboard shows the payment link badge
  order.squareInvoiceId = invoice.id;
  await order.save();

  return { invoiceId: invoice.id, publicUrl };
}

