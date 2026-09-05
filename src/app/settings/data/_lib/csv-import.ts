import { type Address, type CustomerDetails, type Tier } from "~/app/invoices/_lib/types";
import { type SavedItem } from "~/lib/items";
import { parseMoneyInput } from "~/lib/money";

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  /** Alternate header spellings the auto-mapper accepts, pre-normalized (lowercase, alphanumeric only). */
  synonyms?: string[];
}

/** Field key → CSV column index, or null when unmapped. */
export type ColumnMapping = Record<string, number | null>;

export const ITEM_FIELDS: ImportField[] = [
  {
    key: "sku",
    label: "SKU",
    required: true,
    synonyms: ["itemcode", "productcode", "stockcode", "code"],
  },
  {
    key: "name",
    label: "Name",
    required: true,
    synonyms: ["itemname", "productname", "product", "item", "description", "title"],
  },
  { key: "vendor", label: "Vendor", synonyms: ["supplier", "brand", "manufacturer"] },
  { key: "barcode", label: "Barcode", synonyms: ["ean", "upc", "gtin"] },
  {
    key: "unitPrice",
    label: "Unit price",
    required: true,
    synonyms: ["price", "sellprice", "saleprice", "retailprice"],
  },
  { key: "cost", label: "Cost", synonyms: ["costprice", "buyprice", "purchaseprice", "unitcost"] },
];

const TIER_FIELD_PREFIX = "tier:";

/** One optional price field per tier (Tiered pricing module), keyed by tier id. */
export function itemTierFields(tiers: Tier[]): ImportField[] {
  return tiers.map((tier) => ({
    key: `${TIER_FIELD_PREFIX}${tier.id}`,
    label: `${tier.name} price`,
    synonyms: [normalizeHeader(tier.name)],
  }));
}

export const CUSTOMER_FIELDS: ImportField[] = [
  {
    key: "name",
    label: "Name",
    required: true,
    synonyms: ["customername", "customer", "contactname", "contact", "fullname"],
  },
  {
    key: "company",
    label: "Company",
    synonyms: ["companyname", "businessname", "business", "organisation", "organization"],
  },
  { key: "phone", label: "Phone", synonyms: ["phonenumber", "mobile", "telephone", "tel"] },
  { key: "email", label: "Email", synonyms: ["emailaddress"] },
  { key: "tier", label: "Tier", synonyms: ["pricetier", "pricingtier", "customertier"] },
  {
    key: "billingLine1",
    label: "Billing address line 1",
    synonyms: [
      "billingaddress",
      "billingaddress1",
      "addressline1",
      "address1",
      "address",
      "street",
    ],
  },
  {
    key: "billingLine2",
    label: "Billing address line 2",
    synonyms: ["billingaddress2", "addressline2", "address2"],
  },
  {
    key: "billingSuburb",
    label: "Billing suburb",
    synonyms: ["billingcity", "suburb", "city", "town"],
  },
  { key: "billingState", label: "Billing state", synonyms: ["state", "region", "province"] },
  {
    key: "billingPostcode",
    label: "Billing postcode",
    synonyms: ["billingzip", "postcode", "zip", "zipcode", "postalcode"],
  },
  {
    key: "deliveryLine1",
    label: "Delivery address line 1",
    synonyms: [
      "deliveryaddress",
      "deliveryaddress1",
      "shippingaddressline1",
      "shippingaddress",
      "shippingaddress1",
    ],
  },
  {
    key: "deliveryLine2",
    label: "Delivery address line 2",
    synonyms: ["deliveryaddress2", "shippingaddressline2", "shippingaddress2"],
  },
  {
    key: "deliverySuburb",
    label: "Delivery suburb",
    synonyms: ["deliverycity", "shippingsuburb", "shippingcity"],
  },
  { key: "deliveryState", label: "Delivery state", synonyms: ["shippingstate"] },
  {
    key: "deliveryPostcode",
    label: "Delivery postcode",
    synonyms: ["deliveryzip", "shippingpostcode", "shippingzip"],
  },
];

/** Customer import fields; the Tier column only exists while Tiered pricing is on. */
export function customerImportFields(tiers: Tier[] | null): ImportField[] {
  return CUSTOMER_FIELDS.filter((field) => field.key !== "tier" || tiers !== null);
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Best-effort initial mapping: exact label matches win, then synonyms; each column maps at most once. */
export function autoMapColumns(fields: ImportField[], headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of fields) {
    const label = normalizeHeader(field.label);
    const synonyms = field.synonyms ?? [];
    let index = normalized.findIndex((header, i) => !used.has(i) && header === label);
    if (index === -1) {
      index = normalized.findIndex(
        (header, i) => !used.has(i) && header !== "" && synonyms.includes(header),
      );
    }
    mapping[field.key] = index === -1 ? null : index;
    if (index !== -1) used.add(index);
  }
  return mapping;
}

/** One CSV row converted to a record: value when clean, null plus the reasons when not. */
export interface RowConversion<T> {
  value: T | null;
  errors: string[];
}

function cell(row: string[], mapping: ColumnMapping, key: string): string {
  const index = mapping[key];
  return index == null ? "" : (row[index] ?? "").trim();
}

function readText(
  row: string[],
  mapping: ColumnMapping,
  key: string,
  label: string,
  opts: { required?: boolean; maxLength: number },
  errors: string[],
): string {
  const text = cell(row, mapping, key);
  if (opts.required && text === "") errors.push(`${label} is required.`);
  if (text.length > opts.maxLength)
    errors.push(`${label} is longer than ${opts.maxLength} characters.`);
  return text;
}

function readMoneyCents(
  row: string[],
  mapping: ColumnMapping,
  key: string,
  label: string,
  errors: string[],
): number {
  const text = cell(row, mapping, key);
  const cents = parseMoneyInput(text);
  if (cents === null) {
    errors.push(`${label}: "${text}" isn't an amount.`);
    return 0;
  }
  return cents;
}

/** Tier names in the file resolve to tier ids; unknown names fail the row. */
function readTier(
  row: string[],
  mapping: ColumnMapping,
  tiers: Tier[] | null,
  errors: string[],
): string | null {
  const text = cell(row, mapping, "tier");
  if (tiers === null || text === "") return null;
  const match = tiers.find((tier) => tier.name.trim().toLowerCase() === text.toLowerCase());
  if (!match) {
    errors.push(`Tier: "${text}" doesn't match any of your tiers.`);
    return null;
  }
  return match.id;
}

function readAddress(
  row: string[],
  mapping: ColumnMapping,
  prefix: "billing" | "delivery",
  label: string,
  errors: string[],
): Address {
  return {
    line1: readText(
      row,
      mapping,
      `${prefix}Line1`,
      `${label} address line 1`,
      { maxLength: 255 },
      errors,
    ),
    line2: readText(
      row,
      mapping,
      `${prefix}Line2`,
      `${label} address line 2`,
      { maxLength: 255 },
      errors,
    ),
    suburb: readText(
      row,
      mapping,
      `${prefix}Suburb`,
      `${label} suburb`,
      { maxLength: 255 },
      errors,
    ),
    state: readText(row, mapping, `${prefix}State`, `${label} state`, { maxLength: 64 }, errors),
    postcode: readText(
      row,
      mapping,
      `${prefix}Postcode`,
      `${label} postcode`,
      { maxLength: 16 },
      errors,
    ),
  };
}

export function convertItemRow(
  row: string[],
  mapping: ColumnMapping,
  tierFields: ImportField[],
): RowConversion<SavedItem> {
  const errors: string[] = [];
  const tierPrices: Record<string, number> = {};
  for (const field of tierFields) {
    const cents = readMoneyCents(row, mapping, field.key, field.label, errors);
    if (cents > 0) tierPrices[field.key.slice(TIER_FIELD_PREFIX.length)] = cents;
  }
  const value: SavedItem = {
    sku: readText(row, mapping, "sku", "SKU", { required: true, maxLength: 64 }, errors),
    name: readText(row, mapping, "name", "Name", { required: true, maxLength: 256 }, errors),
    vendor: readText(row, mapping, "vendor", "Vendor", { maxLength: 256 }, errors),
    barcode: readText(row, mapping, "barcode", "Barcode", { maxLength: 64 }, errors),
    unitPriceCents: readMoneyCents(row, mapping, "unitPrice", "Unit price", errors),
    tierPrices,
    costCents: readMoneyCents(row, mapping, "cost", "Cost", errors),
  };
  return { value: errors.length > 0 ? null : value, errors };
}

export function convertCustomerRow(
  row: string[],
  mapping: ColumnMapping,
  tiers: Tier[] | null,
): RowConversion<CustomerDetails> {
  const errors: string[] = [];
  const billingAddress = readAddress(row, mapping, "billing", "Billing", errors);
  const deliveryAddress = readAddress(row, mapping, "delivery", "Delivery", errors);
  const deliveryEmpty = Object.values(deliveryAddress).every((part) => part === "");
  const value: CustomerDetails = {
    name: readText(row, mapping, "name", "Name", { required: true, maxLength: 255 }, errors),
    company: readText(row, mapping, "company", "Company", { maxLength: 255 }, errors),
    phone: readText(row, mapping, "phone", "Phone", { maxLength: 64 }, errors),
    email: readText(row, mapping, "email", "Email", { maxLength: 255 }, errors),
    tierId: readTier(row, mapping, tiers, errors),
    billingAddress,
    deliveryAddress: deliveryEmpty ? billingAddress : deliveryAddress,
  };
  return { value: errors.length > 0 ? null : value, errors };
}
