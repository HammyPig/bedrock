"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";

import { AddressField } from "~/app/invoices/_components/address-field";
import {
  customerDetailsMatchesCustomer,
  customerDisplayName,
  emptyCustomerDetails,
} from "~/app/invoices/_lib/invoice";
import { type Customer, type CustomerDetails } from "~/app/invoices/_lib/types";
import { BackLink } from "~/components/back-link";
import { SaveBar } from "~/components/save-bar";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { TierSelect } from "~/components/tier-select";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const CONTACT_FIELDS: {
  field: "name" | "company" | "phone" | "email";
  label: string;
  type?: "tel" | "email";
  /** Name/company feed the "needs a name or company" validation. */
  invalid?: boolean;
}[] = [
  { field: "name", label: "Name", invalid: true },
  { field: "company", label: "Company", invalid: true },
  { field: "phone", label: "Phone", type: "tel" },
  { field: "email", label: "Email", type: "email" },
];

interface CustomerFormProps {
  /** Existing customer being edited; omitted on the create page. */
  initialCustomer?: Customer;
  /** Database id of the customer being edited; omitted on the create page. */
  customerId?: string;
}

export function CustomerForm({ initialCustomer, customerId }: CustomerFormProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const modules = api.settings.modules.useQuery();

  const [draft, setDraft] = useState<CustomerDetails>(initialCustomer ?? emptyCustomerDetails());
  /** Last-saved snapshot; null until a new customer is first saved. */
  const [savedCustomer, setSavedCustomer] = useState<Customer | null>(initialCustomer ?? null);
  const [showErrors, setShowErrors] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const timeout = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(timeout);
  }, [justSaved]);

  const createCustomer = api.customer.create.useMutation({
    onSuccess: async ({ id }) => {
      await utils.customer.list.invalidate();
      router.push(`/customers/${id}/edit`);
    },
  });
  const updateCustomer = api.customer.update.useMutation({
    onSuccess: async () => {
      setJustSaved(true);
      await utils.customer.list.invalidate();
    },
  });
  const deleteCustomer = api.customer.delete.useMutation({
    onSuccess: async () => {
      await utils.customer.list.invalidate();
      router.push("/customers");
    },
  });

  const saving = createCustomer.isPending || updateCustomer.isPending;
  const saveError = (createCustomer.error ?? updateCustomer.error)?.message;

  const missingIdentity = draft.name.trim() === "" && draft.company.trim() === "";
  const error = showErrors && missingIdentity ? "Every customer needs a name or company." : null;
  const dirty = savedCustomer === null || !customerDetailsMatchesCustomer(draft, savedCustomer);

  const patch = (fields: Partial<CustomerDetails>) => setDraft((prev) => ({ ...prev, ...fields }));

  const handleSave = () => {
    if (saving) return;
    if (missingIdentity) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (customerId) {
      updateCustomer.mutate(
        { id: customerId, details: draft },
        { onSuccess: () => setSavedCustomer({ ...draft, id: customerId }) },
      );
    } else {
      // Create lands on the edit page, which remounts the form in sync with the database.
      createCustomer.mutate(draft);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* On the edit page the (editor) sidebar already shows this link at xl and up. */}
      <div className={cn("mb-4", initialCustomer && "xl:hidden")}>
        <BackLink href="/customers">All customers</BackLink>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        {initialCustomer ? `Edit ${customerDisplayName(initialCustomer)}` : "New customer"}
      </h1>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="space-y-6 p-8 sm:p-10">
          <div className="grid gap-6 sm:grid-cols-2">
            {CONTACT_FIELDS.map(({ field, label, type, invalid }) => (
              <section key={field} className="space-y-2">
                <Label htmlFor={`customer-${field}`}>{label}</Label>
                <Input
                  id={`customer-${field}`}
                  type={type}
                  value={draft[field]}
                  placeholder={label}
                  aria-invalid={invalid ? error !== null : undefined}
                  onChange={(e) => patch({ [field]: e.currentTarget.value })}
                />
              </section>
            ))}
            {modules.data?.tieredPricing && (
              <section className="space-y-2">
                <Label htmlFor="customer-tier">Tier</Label>
                <TierSelect
                  id="customer-tier"
                  value={draft.tierId}
                  onChange={(tierId) => patch({ tierId })}
                />
              </section>
            )}
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <section className="space-y-2">
              <Label>Billing address</Label>
              <AddressField
                labelPrefix="Billing"
                value={draft.billingAddress}
                onChange={(billingAddress) => patch({ billingAddress })}
              />
            </section>
            <section className="space-y-2">
              <Label>Delivery address</Label>
              <AddressField
                labelPrefix="Delivery"
                value={draft.deliveryAddress}
                onChange={(deliveryAddress) => patch({ deliveryAddress })}
              />
            </section>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          {/* Kept out of the header so a stray click can't land on it while editing. */}
          {customerId && initialCustomer && (
            <div className="border-t pt-6">
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2Icon />
                    Delete customer
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete this customer?</DialogTitle>
                    <DialogDescription>
                      {`“${customerDisplayName(initialCustomer)}” will be removed from your customers. Invoices that already bill them keep their own copy.`}
                    </DialogDescription>
                  </DialogHeader>
                  {deleteCustomer.error && (
                    <p className="text-destructive text-sm">{deleteCustomer.error.message}</p>
                  )}
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button
                      variant="destructive"
                      disabled={deleteCustomer.isPending}
                      onClick={() => deleteCustomer.mutate({ id: customerId })}
                    >
                      {deleteCustomer.isPending ? "Deleting…" : "Delete customer"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
        <SaveBar
          summary={dirty ? (customerId ? "Unsaved changes" : "Not saved yet") : null}
          justSaved={justSaved}
          saving={saving}
          saveError={saveError}
          cancelHref={customerId ? `/customers/${customerId}` : "/customers"}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
