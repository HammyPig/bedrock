import { relations } from "drizzle-orm";
import { index, pgTableCreator, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { type AdapterAccount } from "next-auth/adapters";

import type { Address, CustomerDetails, Discount, PaymentTerms } from "~/app/invoices/_lib/types";
import type { VendorDetails } from "~/app/purchase-orders/_lib/types";
import {
  DEFAULT_EMAIL_BODY,
  DEFAULT_EMAIL_SUBJECT,
  defaultModules,
  type Modules,
} from "~/app/settings/_lib/settings";

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

/**
 * Pricing tiers (Tiered pricing module). Named per business and ordered by
 * position; customers are assigned a tier and items price per tier. All tier
 * data lives in this table and itemTierPrices, so the core tables stay
 * module-free and turning the module off simply leaves them unread.
 */
export const tiers = createTable(
  "tier",
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
    name: d.varchar({ length: 64 }).notNull(),
    position: d.integer().notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [index("tier_business_id_idx").on(t.businessId)],
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
    vendor: d.varchar({ length: 256 }).notNull().default(""),
    barcode: d.varchar({ length: 64 }).notNull().default(""),
    unitPriceCents: d.integer().notNull(),
    /** What the business pays its vendor — internal only, never shown on invoices. */
    costCents: d.integer().notNull().default(0),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("item_business_id_idx").on(t.businessId)],
);

/**
 * A tier's price for a catalog item (Tiered pricing module). A row exists only
 * when a price is set — no row means the tier pays the item's unit price.
 */
export const itemTierPrices = createTable(
  "item_tier_price",
  (d) => ({
    itemId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    tierId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => tiers.id, { onDelete: "cascade" }),
    priceCents: d.integer().notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.itemId, t.tierId] }),
    index("item_tier_price_tier_id_idx").on(t.tierId),
  ],
);

export const itemsRelations = relations(items, ({ many }) => ({
  tierPrices: many(itemTierPrices),
}));

export const itemTierPricesRelations = relations(itemTierPrices, ({ one }) => ({
  item: one(items, { fields: [itemTierPrices.itemId], references: [items.id] }),
  tier: one(tiers, { fields: [itemTierPrices.tierId], references: [tiers.id] }),
}));

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
    /** Pricing tier assignment (Tiered pricing module); null when unassigned. */
    tierId: d.varchar({ length: 255 }).references(() => tiers.id, { onDelete: "set null" }),
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

/** Suppliers the business orders from; purchase orders draw their vendor snapshot from here. */
export const vendors = createTable(
  "vendor",
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
    address: d.jsonb().$type<Address>().notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("vendor_business_id_idx").on(t.businessId)],
);

/**
 * Columns mirror InvoiceDraft minus lineItems. customerDetails is a jsonb snapshot of
 * the customer details at invoice time; customerId is a soft pointer
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
    isQuote: d.boolean().notNull().default(false),
    invoiceNumber: d.varchar({ length: 64 }).notNull(),
    customerDetails: d.jsonb().$type<CustomerDetails>().notNull(),
    customerId: d.varchar({ length: 255 }),
    delivery: d.boolean().notNull(),
    deliverySameAsBilling: d.boolean().notNull(),
    poNumber: d.varchar({ length: 64 }).notNull(),
    issueDate: d.date({ mode: "string" }).notNull(),
    terms: d.varchar({ length: 16 }).$type<PaymentTerms>().notNull(),
    customDueDate: d.date({ mode: "string" }),
    discount: d.jsonb().$type<Discount>(),
    freightCents: d.integer().notNull(),
    taxRatePercent: d.doublePrecision().notNull(),
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
  /** Optional-feature toggles; hides module UI without touching module data. */
  modules: d.jsonb().$type<Modules>().notNull().default(defaultModules()),
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
    backordered: d.boolean().notNull().default(false),
  }),
  (t) => [index("invoice_line_item_invoice_id_idx").on(t.invoiceId)],
);

/**
 * One row per payment received against an invoice; the invoice's paid amount
 * is always the sum of its payments, never stored on the invoice itself.
 */
export const payments = createTable(
  "payment",
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
    amountCents: d.integer().notNull(),
    paidDate: d.date({ mode: "string" }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [index("payment_invoice_id_idx").on(t.invoiceId)],
);

export const invoicesRelations = relations(invoices, ({ many }) => ({
  lineItems: many(invoiceLineItems),
  payments: many(payments),
}));

export const invoiceLineItemsRelations = relations(invoiceLineItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLineItems.invoiceId], references: [invoices.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
}));

/**
 * Columns mirror PurchaseOrderDraft minus lineItems. vendor is a jsonb snapshot
 * of the vendor details at order time; sourceVendorId is a soft pointer (no FK)
 * so a missing vendor degrades to "unsaved" in the UI. Totals stay derived.
 */
export const purchaseOrders = createTable(
  "purchase_order",
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
    poNumber: d.varchar({ length: 64 }).notNull(),
    vendor: d.jsonb().$type<VendorDetails>().notNull(),
    sourceVendorId: d.varchar({ length: 255 }),
    orderDate: d.date({ mode: "string" }).notNull(),
    expectedDate: d.date({ mode: "string" }),
    discount: d.jsonb().$type<Discount>(),
    freightCents: d.integer().notNull(),
    taxRatePercent: d.doublePrecision().notNull(),
    notes: d.text().notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("purchase_order_business_id_idx").on(t.businessId),
    uniqueIndex("purchase_order_business_number_idx").on(t.businessId, t.poNumber),
  ],
);

/** Denormalized snapshot of a catalog item at order time — no FK to items. */
export const purchaseOrderLineItems = createTable(
  "purchase_order_line_item",
  (d) => ({
    id: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    purchaseOrderId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    position: d.integer().notNull(),
    sku: d.varchar({ length: 64 }).notNull(),
    name: d.text().notNull(),
    quantity: d.doublePrecision().notNull(),
    unitPriceCents: d.integer().notNull(),
    discountPercent: d.doublePrecision().notNull(),
  }),
  (t) => [index("purchase_order_line_item_po_id_idx").on(t.purchaseOrderId)],
);

export const purchaseOrdersRelations = relations(purchaseOrders, ({ many }) => ({
  lineItems: many(purchaseOrderLineItems),
}));

export const purchaseOrderLineItemsRelations = relations(purchaseOrderLineItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderLineItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
}));
