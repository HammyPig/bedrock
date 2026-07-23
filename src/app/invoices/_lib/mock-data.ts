import { fakerEN_AU as faker } from "@faker-js/faker";

import { type Address } from "./types";

// Fixed seed so the generated list is stable across reloads instead of reshuffling every render.
faker.seed(20260722);

function fakeAddress(): Address {
  return {
    line1: faker.location.streetAddress(),
    line2: "",
    suburb: faker.location.city(),
    state: faker.location.state({ abbreviated: true }),
    postcode: faker.location.zipCode(),
  };
}

/** Stand-in for a real address-lookup service (e.g. Google Places, Addressify). */
export const mockAddressSuggestions: Address[] = Array.from({ length: 15 }, () => fakeAddress());
