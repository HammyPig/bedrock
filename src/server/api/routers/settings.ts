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
}) satisfies z.ZodType<Modules>;

function toSettings(row: typeof businessSettings.$inferSelect): BusinessSettings {
  return {
    businessName: row.businessName,
    taxId: row.taxId,
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

/**
 * Settings with nextInvoiceNumber advanced to the effective next sequence:
 * the stored floor pushed past any invoice numbers already used under the
 * prefix, keeping the stored padding width. Suggestions built from this can
 * never collide with an existing invoice.
 */
export async function loadEffectiveSettings(
  db: typeof database,
  businessId: string,
): Promise<BusinessSettings> {
  const row = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.businessId, businessId),
  });
  const settings = row ? toSettings(row) : defaultSettings();

  const invoiceRows = await db
    .select({ invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(eq(invoices.businessId, businessId));

  let sequence = Number(settings.nextInvoiceNumber);
  for (const { invoiceNumber } of invoiceRows) {
    const existing = invoiceNumberSequence(settings.invoiceNumberPrefix, invoiceNumber);
    if (existing !== null && existing >= sequence) sequence = existing + 1;
  }

  const width = settings.nextInvoiceNumber.length;
  return { ...settings, nextInvoiceNumber: String(sequence).padStart(width, "0") };
}

/** The business's module toggles; a business with no settings row has every module off. */
export async function loadModules(db: typeof database, businessId: string): Promise<Modules> {
  const row = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.businessId, businessId),
    columns: { modules: true },
  });
  return row?.modules ?? defaultModules();
}

export const settingsRouter = createTRPCRouter({
  get: businessProcedure.query(({ ctx }) => loadEffectiveSettings(ctx.db, ctx.businessId)),

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
    // Re-read so the client's form resets to the effective next number, not
    // the raw floor it submitted.
    return loadEffectiveSettings(ctx.db, businessId);
  }),
});
