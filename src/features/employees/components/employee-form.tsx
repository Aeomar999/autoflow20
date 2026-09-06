"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  dateOnlySchema,
  employeeRefSchema,
} from "@/features/employees/lib/employee";

import { useCreateEmployee, useUpdateEmployee } from "../hooks/use-employees";

/**
 * AF-M11-08. Manual create + patch forms.
 *
 * Neither form can touch `status`: the lifecycle is moved by the handoff
 * layer's guarded transitions and by nothing else, which is why
 * `employees.patch` accepts HR fields only. A "set status" control here would
 * be a second, unguarded way into the chain — exactly what AF-M11-02 exists to
 * prevent — so status is displayed on the detail page and never edited.
 *
 * Blank optional fields are submitted as `undefined` on create (the row is
 * being made) and as `null` on patch (the field is being cleared);
 * `patchInputSchema` is `.nullish()` for precisely that difference.
 */

/** A blank optional input means "not set", not the empty string. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const optionalEmail = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine(
    (value) =>
      value === undefined || z.string().email().safeParse(value).success,
    { message: "Enter a valid email address" },
  );

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine(
    (value) => value === undefined || dateOnlySchema.safeParse(value).success,
    { message: "Use the date picker (YYYY-MM-DD)" },
  );

const employeeFieldsSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  fullName: z.string().trim().min(1, "Full name is required").max(300),
  role: z.string().trim().min(1, "Role is required").max(200),
  department: optionalText(200),
  managerEmail: optionalEmail,
  personalEmail: optionalEmail,
  startDate: optionalDate,
});

const createSchema = employeeFieldsSchema.extend({
  employeeRef: employeeRefSchema,
});

type CreateValues = z.input<typeof createSchema>;
type EditValues = z.input<typeof employeeFieldsSchema>;

const EMPTY_CREATE: CreateValues = {
  employeeRef: "",
  email: "",
  fullName: "",
  role: "",
  department: "",
  managerEmail: "",
  personalEmail: "",
  startDate: "",
};

export type EmployeeDetail = {
  id: string;
  employeeRef: string;
  email: string;
  fullName: string;
  role: string;
  department: string | null;
  managerEmail: string | null;
  personalEmail: string | null;
  startDate: Date | string | null;
};

const toDateInput = (value: Date | string | null): string =>
  value === null ? "" : new Date(value).toISOString().slice(0, 10);

export const EmployeeCreateDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const create = useCreateEmployee();
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: EMPTY_CREATE,
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await create.mutateAsync(createSchema.parse(values));
    form.reset(EMPTY_CREATE);
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an employee</DialogTitle>
          <DialogDescription>
            Creates the record as a candidate. The lifecycle workflows move it
            forward from there — status is never set by hand.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="grid gap-4">
            <FormField
              control={form.control}
              name="employeeRef"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee reference</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="EMP-ADA-009" />
                  </FormControl>
                  <FormDescription>
                    The stable business key every handoff is addressed by.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ada Boateng" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Account Executive" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Work email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="ada@example.com"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Sales" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="managerEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Manager email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="manager@example.com"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : null}
                Add employee
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export const EmployeeEditDialog = ({
  employee,
  open,
  onOpenChange,
}: {
  employee: EmployeeDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const update = useUpdateEmployee();

  const form = useForm<EditValues>({
    resolver: zodResolver(employeeFieldsSchema),
    defaultValues: {
      email: employee.email,
      fullName: employee.fullName,
      role: employee.role,
      department: employee.department ?? "",
      managerEmail: employee.managerEmail ?? "",
      personalEmail: employee.personalEmail ?? "",
      startDate: toDateInput(employee.startDate),
    },
  });

  const { reset } = form;

  // Re-seed when the dialog reopens on a record that refreshed underneath it.
  useEffect(() => {
    if (!open) return;
    reset({
      email: employee.email,
      fullName: employee.fullName,
      role: employee.role,
      department: employee.department ?? "",
      managerEmail: employee.managerEmail ?? "",
      personalEmail: employee.personalEmail ?? "",
      startDate: toDateInput(employee.startDate),
    });
  }, [open, employee, reset]);

  const onSubmit = form.handleSubmit(async (values) => {
    const parsed = employeeFieldsSchema.parse(values);
    // A cleared optional field is `null` (clear it), never `undefined` (leave
    // it alone) — the patch router distinguishes the two deliberately.
    await update.mutateAsync({
      id: employee.id,
      email: parsed.email,
      fullName: parsed.fullName,
      role: parsed.role,
      department: parsed.department ?? null,
      managerEmail: parsed.managerEmail ?? null,
      personalEmail: parsed.personalEmail ?? null,
      startDate: parsed.startDate ?? null,
    });
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {employee.fullName}</DialogTitle>
          <DialogDescription>
            HR fields only. Lifecycle status is moved by the workflows and
            cannot be edited here.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Work email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="managerEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Manager email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="personalEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Personal email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={update.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : null}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
