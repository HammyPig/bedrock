import { relations } from "drizzle-orm";
import { index, pgTableCreator, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { type AdapterAccount } from "next-auth/adapters";

import type {
  Address,
  BillTo,
  CustomerTier,
  Discount,
  PaymentTerms,
} from "~/app/invoices/_lib/types";
import { DEFAULT_EMAIL_BODY, DEFAULT_EMAIL_SUBJECT } from "~/app/settings/_lib/settings";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `bedrock_${name}`);

export const users = createTable("user", (d) => ({
  id: d
    .varchar({ length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: d.varchar({ length: 255 }),
  email: d.varchar({ length: 255 }).notNull(),
  emailVerified: d
    .timestamp({
      mode: "date",
      withTimezone: true,
    })
    .$defaultFn(() => /* @__PURE__ */ new Date()),
  image: d.varchar({ length: 255 }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
}));

export const accounts = createTable(
  "account",
  (d) => ({
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    type: d.varchar({ length: 255 }).$type<AdapterAccount["type"]>().notNull(),
    provider: d.varchar({ length: 255 }).notNull(),
    providerAccountId: d.varchar({ length: 255 }).notNull(),
    refresh_token: d.text(),
    access_token: d.text(),
    expires_at: d.integer(),
    token_type: d.varchar({ length: 255 }),
    scope: d.varchar({ length: 255 }),
    id_token: d.text(),
    session_state: d.varchar({ length: 255 }),
  }),
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("account_user_id_idx").on(t.userId),
  ],
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessions = createTable(
  "session",
  (d) => ({
    sessionToken: d.varchar({ length: 255 }).notNull().primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [index("t_user_id_idx").on(t.userId)],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const verificationTokens = createTable(
  "verification_token",
  (d) => ({
    identifier: d.varchar({ length: 255 }).notNull(),
    token: d.varchar({ length: 255 }).notNull(),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/**
 * The tenant: all invoicing data (items, customers, invoices, settings) hangs
 * off a business, and users reach it through a businessUsers membership row.
 * ownerUserId is the user who created the business.
 */
export const businesses = createTable("business", (d) => ({
  id: d
    .varchar({ length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  ownerUserId: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => users.id),
  createdAt: d
    .timestamp({ withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
}));

/** Membership link. userId as primary key = a user belongs to at most one business. */
export const businessUsers = createTable(
  "business_user",
  (d) => ({
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .references(() => users.id),
    businessId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => businesses.id),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [index("business_user_business_id_idx").on(t.businessId)],
);

/**
 * Pending invite, keyed by lowercased email. Claimed — converted into a
 * businessUsers row — the next time a user with a matching email is seen.
 */
export const businessInvites = createTable(
  "business_invite",
  (d) => ({
    id: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    businessId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => businesses.id),
    email: d.varchar({ length: 255 }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    uniqueIndex("business_invite_business_email_idx").on(t.businessId, t.email),
    index("business_invite_email_idx").on(t.email),
  ],
);

/** Catalog of products/services the invoice line-item lookup draws from. */
export const items = createTable(
  "item",
  (d) => ({
    id: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    businessId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => businesses.id),
    sku: d.varchar({ length: 64 }).notNull(),
    name: d.varchar({ length: 256 }).notNull(),
    unitPriceCents: d.integer().notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("item_business_id_idx").on(t.businessId)],
);

export const customers = createTable(
  "customer",
  (d) => ({
    id: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    businessId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => businesses.id),
    name: d.varchar({ length: 255 }).notNull(),
    company: d.varchar({ length: 255 }).notNull(),
    phone: d.varchar({ length: 64 }).notNull(),
    email: d.varchar({ length: 255 }).notNull(),
    tier: d.varchar({ length: 16 }).$type<CustomerTier | "">().notNull(),
    billingAddress: d.jsonb().$type<Address>().notNull(),
    deliveryAddress: d.jsonb().$type<Address>().notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("customer_business_id_idx").on(t.businessId)],
);

/**
 * Columns mirror InvoiceDraft minus lineItems. billTo is a jsonb snapshot of
 * the customer details at invoice time; sourceCustomerId is a soft pointer
 * (no FK) so a missing customer degrades to "unsaved" in the UI. Due date,
 * status, and totals stay derived — never stored.
 */
export const invoices = createTable(
  "invoice",
  (d) => ({
    id: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    businessId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => businesses.id),
    invoiceNumber: d.varchar({ length: 64 }).notNull(),
    billTo: d.jsonb().$type<BillTo>().notNull(),
    sourceCustomerId: d.varchar({ length: 255 }),
    delivery: d.boolean().notNull(),
    deliverySameAsBilling: d.boolean().notNull(),
    poNumber: d.varchar({ length: 64 }).notNull(),
    issueDate: d.date({ mode: "string" }).notNull(),
    terms: d.varchar({ length: 16 }).$type<PaymentTerms>().notNull(),
    customDueDate: d.date({ mode: "string" }),
    discount: d.jsonb().$type<Discount>(),
    freightCents: d.integer().notNull(),
    taxRatePercent: d.doublePrecision().notNull(),
    paidCents: d.integer().notNull(),
    notes: d.text().notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("invoice_business_id_idx").on(t.businessId),
    uniqueIndex("invoice_business_number_idx").on(t.businessId, t.invoiceNumber),
  ],
);

/**
 * One row per business: the identity and appearance printed on invoices plus
 * invoice numbering preferences. nextInvoiceNumber is the zero-padded sequence
 * the next invoice should use ("000213") — its length sets the padding width,
 * and it's a floor, not a counter: invoice numbers already used push past it.
 */
export const businessSettings = createTable("business_settings", (d) => ({
  businessId: d
    .varchar({ length: 255 })
    .notNull()
    .primaryKey()
    .references(() => businesses.id),
  businessName: d.varchar({ length: 255 }).notNull(),
  taxId: d.varchar({ length: 64 }).notNull(),
  address: d.jsonb().$type<Address>().notNull(),
  website: d.varchar({ length: 255 }).notNull(),
  email: d.varchar({ length: 255 }).notNull(),
  phone: d.varchar({ length: 64 }).notNull(),
  logo: d.text().notNull().default(""),
  accentColor: d.varchar({ length: 16 }).notNull().default("#111827"),
  emailSubject: d.varchar({ length: 255 }).notNull().default(DEFAULT_EMAIL_SUBJECT),
  emailBody: d.text().notNull().default(DEFAULT_EMAIL_BODY),
  paymentDetails: d.text().notNull(),
  termsAndConditions: d.text().notNull(),
  invoiceNumberPrefix: d.varchar({ length: 16 }).notNull(),
  nextInvoiceNumber: d.varchar({ length: 20 }).notNull(),
  createdAt: d
    .timestamp({ withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

/** Denormalized snapshot of a catalog item at invoice time — no FK to items. */
export const invoiceLineItems = createTable(
  "invoice_line_item",
  (d) => ({
    id: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    invoiceId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    position: d.integer().notNull(),
    sku: d.varchar({ length: 64 }).notNull(),
    name: d.text().notNull(),
    quantity: d.doublePrecision().notNull(),
    unitPriceCents: d.integer().notNull(),
    discountPercent: d.doublePrecision().notNull(),
  }),
  (t) => [index("invoice_line_item_invoice_id_idx").on(t.invoiceId)],
);

export const invoicesRelations = relations(invoices, ({ many }) => ({
  lineItems: many(invoiceLineItems),
}));

export const invoiceLineItemsRelations = relations(invoiceLineItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLineItems.invoiceId], references: [invoices.id] }),
}));
