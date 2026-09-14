import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  defaultModules,
  defaultSettings,
  invoiceNumberSequence,
  type BusinessSettings,
  type Modules,
} from "~/app/settings/_lib/settings";
import { addressInput } from "~/server/api/routers/customer";
import { businessProcedure, createTRPCRouter } from "~/server/api/trpc";
import { businessSettings, invoices } from "~/server/db/schema";
import { type db as database } from "~/server/db";

export const settingsInput = z.object({
  businessName: z.string().max(255),
  taxId: z.string().max(64),
  gstRegistered: z.boolean(),
  address: addressInput,
  website: z.string().max(255),
  email: z.string().max(255),
  phone: z.string().max(64),
  logo: z
    .string()
    .max(1_500_000, "Logo image is too large.")
    .refine((value) => value === "" || value.startsWith("data:image/"), "Logo must be an image."),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i, "Colour must be a six-digit hex value."),
  emailSubject: z.string().max(255),
  emailBody: z.string(),
  paymentDetails: z.string(),
  termsAndConditions: z.string(),
  invoiceNumberPrefix: z.string().max(16),
  nextInvoiceNumber: z
    .string()
    .max(20)
    .regex(/^\d+$/, "Next number must be digits only.")
    .refine((value) => Number(value) >= 1, "Next number must be 1 or higher."),
}) satisfies z.ZodType<BusinessSettings>;

const modulesInput = z.object({
  tieredPricing: z.boolean(),
  lineDiscounts: z.boolean(),
  backorders: z.boolean(),
  payments: z.boolean(),
  purchaseOrders: z.boolean(),
}) satisfies z.ZodType<Modules>;

function toSettings(row: typeof businessSettings.$inferSelect): BusinessSettings {
  return {
    businessName: row.businessName,
    taxId: row.taxId,
    gstRegistered: row.gstRegistered,
    address: row.address,
    website: row.website,
    email: row.email,
    phone: row.phone,
    logo: row.logo,
    accentColor: row.accentColor,
    emailSubject: row.emailSubject,
    emailBody: row.emailBody,
    paymentDetails: row.paymentDetails,
    termsAndConditions: row.termsAndConditions,
    invoiceNumberPrefix: row.invoiceNumberPrefix,
    nextInvoiceNumber: row.nextInvoiceNumber,
  };
}

/** The business's stored settings, or defaults for a business without a row yet. */
export async function loadSettings(
  db: typeof database,
  businessId: string,
): Promise<BusinessSettings> {
  const row = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.businessId, businessId),
  });
  return row ? toSettings(row) : defaultSettings();
}

/** The transaction handle `db.transaction` hands its callback. */
type Transaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

/**
 * Takes the next number off the business's counter and advances it, stepping
 * over any sequence already in use — numbers set by hand are what put the
 * counter out of step, so it can't be assumed free on its own.
 *
 * Runs in the caller's transaction and locks the settings row, so two invoices
 * saved at the same moment queue up rather than both taking the same number.
 */
export async function assignNextInvoiceNumber(
  tx: Transaction,
  businessId: string,
): Promise<string> {
  const [row] = await tx
    .select()
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId))
    .for("update");
  // Creating a business writes its settings row in the same transaction.
  if (!row) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Business has no settings." });
  }

  const { invoiceNumberPrefix: prefix, nextInvoiceNumber } = row;
  // Matching the prefix in SQL would mean escaping the LIKE wildcards a prefix
  // is free to contain, so the column comes back whole and the parse filters it.
  const usedRows = await tx
    .select({ invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(eq(invoices.businessId, businessId));
  const taken = new Set(
    usedRows
      .map(({ invoiceNumber }) => invoiceNumberSequence(prefix, invoiceNumber))
      .filter((sequence): sequence is number => sequence !== null),
  );

  // Compared as sequences, not strings, so INV-42 also rules out INV-0042.
  let sequence = Number(nextInvoiceNumber);
  while (taken.has(sequence)) sequence += 1;

  const width = nextInvoiceNumber.length;
  await tx
    .update(businessSettings)
    .set({ nextInvoiceNumber: String(sequence + 1).padStart(width, "0") })
    .where(eq(businessSettings.businessId, businessId));

  return prefix + String(sequence).padStart(width, "0");
}

/** The business's module toggles; a business with no settings row has every module off. */
export async function loadModules(db: typeof database, businessId: string): Promise<Modules> {
  const row = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.businessId, businessId),
    columns: { modules: true },
  });
  return row?.modules ?? defaultModules();
}

/**
 * Business procedure that additionally requires the Purchase orders module.
 * Gating the routers — not just the routes — keeps a turned-off module from
 * being reachable through a stale client or a hand-rolled request.
 */
export const purchaseOrdersProcedure = businessProcedure.use(async ({ ctx, next }) => {
  const modules = await loadModules(ctx.db, ctx.businessId);
  if (!modules.purchaseOrders) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Purchase orders are turned off." });
  }
  return next();
});

/** Business procedure that additionally requires the Payments module. */
export const paymentsProcedure = businessProcedure.use(async ({ ctx, next }) => {
  const modules = await loadModules(ctx.db, ctx.businessId);
  if (!modules.payments) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Payments are turned off." });
  }
  return next();
});

export const settingsRouter = createTRPCRouter({
  get: businessProcedure.query(({ ctx }) => loadSettings(ctx.db, ctx.businessId)),

  modules: businessProcedure.query(({ ctx }) => loadModules(ctx.db, ctx.businessId)),

  setModules: businessProcedure.input(modulesInput).mutation(async ({ ctx, input }) => {
    // The settings row may not exist yet; seed it with defaults if so.
    await ctx.db
      .insert(businessSettings)
      .values({ ...defaultSettings(), businessId: ctx.businessId, modules: input })
      .onConflictDoUpdate({ target: businessSettings.businessId, set: { modules: input } });
    return input;
  }),

  save: businessProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
    const businessId = ctx.businessId;
    await ctx.db
      .insert(businessSettings)
      .values({ ...input, businessId })
      .onConflictDoUpdate({ target: businessSettings.businessId, set: input });
    // Re-read so the client's form resets to exactly what was stored.
    return loadSettings(ctx.db, businessId);
  }),
});
