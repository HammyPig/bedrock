import { fakerEN_AU as faker } from "@faker-js/faker";

import { emptyAddress } from "./invoice";
import { type Address, type Customer, type CustomerTier } from "./types";

export const SUGGESTED_INVOICE_NUMBER = "INV-0042";

// Fixed seed so the generated list is stable across reloads instead of reshuffling every render.
faker.seed(20260722);

const CUSTOMER_COUNT = 12;
const CUSTOMER_TIERS: CustomerTier[] = ["tier_1", "tier_2", "tier_3"];

function fakeAddress(): Address {
  return {
    line1: faker.location.streetAddress(),
    line2: "",
    suburb: faker.location.city(),
    state: faker.location.state({ abbreviated: true }),
    postcode: faker.location.zipCode(),
  };
}

export const mockCustomers: Customer[] = Array.from({ length: CUSTOMER_COUNT }, (_, i) => {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();

  return {
    id: `c-${i + 1}`,
    name: `${firstName} ${lastName}`,
    company: faker.company.name(),
    phone: faker.phone.number(),
    email: faker.internet.email({ firstName, lastName }).toLowerCase(),
    tier: faker.helpers.arrayElement(CUSTOMER_TIERS),
    billingAddress: fakeAddress(),
    // A minority of customers ship somewhere other than their billing address.
    deliveryAddress: faker.datatype.boolean({ probability: 0.2 }) ? fakeAddress() : emptyAddress(),
  };
});

/** Stand-in for a real address-lookup service (e.g. Google Places, Addressify). */
export const mockAddressSuggestions: Address[] = Array.from({ length: 15 }, () => fakeAddress());
