import { fakerEN_AU as faker } from "@faker-js/faker";

export interface SavedItem {
  sku: string;
  name: string;
  unitPriceCents: number;
}

// Own fixed seed, applied immediately before generating: the list stays stable
// across reloads and doesn't depend on which module touched faker first.
faker.seed(20260723);

const SAVED_ITEM_COUNT = 15;

export const mockSavedItems: SavedItem[] = Array.from({ length: SAVED_ITEM_COUNT }, () => ({
  sku: faker.string.alphanumeric({ length: 6, casing: "upper" }),
  name: faker.commerce.productName(),
  unitPriceCents: Math.round(Number(faker.commerce.price({ min: 5, max: 500 })) * 100),
}));
