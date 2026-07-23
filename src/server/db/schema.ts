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

/** Catalog of products/services the invoice line-item lookup draws from. */
export const items = createTable(
  "item",
  (d) => ({
    id: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    sku: d.varchar({ length: 64 }).notNull(),
    name: d.varchar({ length: 256 }).notNull(),
    unitPriceCents: d.integer().notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("item_user_id_idx").on(t.userId)],
);

export const customers = createTable(
  "customer",
  (d) => ({
    id: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
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
  (t) => [index("customer_user_id_idx").on(t.userId)],
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
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
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
    index("invoice_user_id_idx").on(t.userId),
    uniqueIndex("invoice_user_number_idx").on(t.userId, t.invoiceNumber),
  ],
);

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
