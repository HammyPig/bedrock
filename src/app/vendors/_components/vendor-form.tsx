"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";

import { AddressField } from "~/app/invoices/_components/address-field";
import {
  emptyVendorDetails,
  vendorDisplayName,
  vendorMatchesSaved,
} from "~/app/purchase-orders/_lib/purchase-order";
import { type Vendor, type VendorDetails } from "~/app/purchase-orders/_lib/types";
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

interface VendorFormProps {
  /** Existing vendor being edited; omitted on the create page. */
  initialVendor?: Vendor;
  /** Database id of the vendor being edited; omitted on the create page. */
  vendorId?: string;
}

export function VendorForm({ initialVendor, vendorId }: VendorFormProps) {
  const router = useRouter();
  const utils = api.useUtils();

  const [draft, setDraft] = useState<VendorDetails>(initialVendor ?? emptyVendorDetails());
  /** Last-saved snapshot; null until a new vendor is first saved. */
  const [savedVendor, setSavedVendor] = useState<Vendor | null>(initialVendor ?? null);
  const [showErrors, setShowErrors] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const timeout = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(timeout);
  }, [justSaved]);

  const createVendor = api.vendor.create.useMutation({
    onSuccess: async ({ id }) => {
      await utils.vendor.list.invalidate();
      router.push(`/vendors/${id}/edit`);
    },
  });
  const updateVendor = api.vendor.update.useMutation({
    onSuccess: async () => {
      setJustSaved(true);
      await utils.vendor.list.invalidate();
    },
  });
  const deleteVendor = api.vendor.delete.useMutation({
    onSuccess: async () => {
      await utils.vendor.list.invalidate();
      router.push("/vendors");
    },
  });

  const saving = createVendor.isPending || updateVendor.isPending;
  const saveError = (createVendor.error ?? updateVendor.error)?.message;

  const missingIdentity = draft.name.trim() === "" && draft.company.trim() === "";
  const error = showErrors && missingIdentity ? "Every vendor needs a name or company." : null;
  const dirty = savedVendor === null || !vendorMatchesSaved(draft, savedVendor);

  const patch = (fields: Partial<VendorDetails>) => setDraft((prev) => ({ ...prev, ...fields }));

  const handleSave = () => {
    if (saving) return;
    if (missingIdentity) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (vendorId) {
      updateVendor.mutate(
        { id: vendorId, details: draft },
        { onSuccess: () => setSavedVendor({ ...draft, id: vendorId }) },
      );
    } else {
      // Create lands on the edit page, which remounts the form in sync with the database.
      createVendor.mutate(draft);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* On the edit page the (editor) sidebar already shows this link at xl and up. */}
      <div className={cn("mb-4", initialVendor && "xl:hidden")}>
        <BackLink href="/vendors">All vendors</BackLink>
      </div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {initialVendor ? `Edit ${vendorDisplayName(initialVendor)}` : "New vendor"}
        </h1>
        {vendorId && initialVendor && (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2Icon />
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this vendor?</DialogTitle>
                <DialogDescription>
                  {`“${vendorDisplayName(initialVendor)}” will be removed from your vendors. Purchase orders that already use them keep their own copy.`}
                </DialogDescription>
              </DialogHeader>
              {deleteVendor.error && (
                <p className="text-destructive text-sm">{deleteVendor.error.message}</p>
              )}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  disabled={deleteVendor.isPending}
                  onClick={() => deleteVendor.mutate({ id: vendorId })}
                >
                  {deleteVendor.isPending ? "Deleting…" : "Delete vendor"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <div className="bg-card rounded-xl border shadow-sm">
        <div className="space-y-6 p-8 sm:p-10">
          <div className="grid gap-6 sm:grid-cols-2">
            {CONTACT_FIELDS.map(({ field, label, type, invalid }) => (
              <section key={field} className="space-y-2">
                <Label htmlFor={`vendor-${field}`}>{label}</Label>
                <Input
                  id={`vendor-${field}`}
                  type={type}
                  value={draft[field]}
                  placeholder={label}
                  aria-invalid={invalid ? error !== null : undefined}
                  onChange={(e) => patch({ [field]: e.currentTarget.value })}
                />
              </section>
            ))}
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <section className="space-y-2">
              <Label>Address</Label>
              <AddressField
                labelPrefix="Vendor"
                value={draft.address}
                onChange={(address) => patch({ address })}
              />
            </section>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <SaveBar
          summary={dirty ? (vendorId ? "Unsaved changes" : "Not saved yet") : null}
          justSaved={justSaved}
          saving={saving}
          saveError={saveError}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
