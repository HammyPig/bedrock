import { businessRouter } from "~/server/api/routers/business";
import { customerRouter } from "~/server/api/routers/customer";
import { invoiceRouter } from "~/server/api/routers/invoice";
import { itemRouter } from "~/server/api/routers/item";
import { purchaseOrderRouter } from "~/server/api/routers/purchase-order";
import { settingsRouter } from "~/server/api/routers/settings";
import { vendorRouter } from "~/server/api/routers/vendor";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  business: businessRouter,
  customer: customerRouter,
  invoice: invoiceRouter,
  item: itemRouter,
  purchaseOrder: purchaseOrderRouter,
  settings: settingsRouter,
  vendor: vendorRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.invoice.list();
 *       ^? Invoice[]
 */
export const createCaller = createCallerFactory(appRouter);
