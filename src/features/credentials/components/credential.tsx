"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2, Plug2, Trash2, XCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { type Resolver, useForm } from "react-hook-form";
import z from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpgradeModal } from "@/hooks/use-upgrade-modal";
import {
  CREDENTIAL_TYPE_IDS,
  credentialDefsById,
  credentialManifest,
} from "../credential-types";
import {
  useCreateCredential,
  useSuspenseCredential,
  useTestCredential,
  useUpdateCredential,
} from "../hooks/use-credentials";
import { DeleteCredentialDialog } from "./delete-credential-dialog";
import { SecretInput } from "./secret-input";

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

interface FormValues extends Record<string, string | undefined> {
  name: string;
  type: string;
}

/**
 * Build the form validation schema. In edit mode, secret fields are optional
 * (the user only needs to provide them when changing the value).
 */
function buildFormSchema(isEditMode: boolean): z.ZodType<FormValues> {
  return z
    .object({
      name: z.string().min(1, "Name is required"),
      type: z.enum(CREDENTIAL_TYPE_IDS, {
        message: "Unknown credential type",
      }),
    })
    .and(z.record(z.string(), z.string().optional()))
    .superRefine((values, ctx) => {
      const def = credentialDefsById.get(values.type);
      for (const field of def?.fields ?? []) {
        if (field.optional) continue;
        // In edit mode, secret fields are optional (blank = keep existing).
        if (isEditMode && field.secret) continue;
        if (!values[field.key]) {
          ctx.addIssue({
            code: "custom",
            path: [field.key],
            message: `${field.label} is required`,
          });
        }
      }
    });
}

// ---------------------------------------------------------------------------
// Test connection result display
// ---------------------------------------------------------------------------

type TestResult = { ok: true } | { ok: false; error: string };

function TestResultBadge({ result }: { result: TestResult }) {
  if (result.ok) {
    return (
      <Badge
        variant="outline"
        className="gap-1 text-green-600 border-green-200 bg-green-50"
      >
        <CheckCircle2 className="size-3.5" />
        Connected
      </Badge>
    );
  }
  const labels: Record<string, string> = {
    AUTH: "Auth failed",
    CONNECTION: "Connection error",
    TIMEOUT: "Timed out",
    NOT_TESTABLE: "Not testable",
  };
  return (
    <Badge
      variant="outline"
      className="gap-1 text-red-600 border-red-200 bg-red-50"
    >
      <XCircle className="size-3.5" />
      {labels[result.error] ?? "Failed"}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CredentialFormProps {
  initialData?: {
    id?: string;
    name: string;
    type: string;
    preview?: string | null;
    usageCount?: number;
  };
}

type CreateInput = Parameters<
  ReturnType<typeof useCreateCredential>["mutateAsync"]
>[0];
type UpdateInput = Parameters<
  ReturnType<typeof useUpdateCredential>["mutateAsync"]
>[0];

// ---------------------------------------------------------------------------
// CredentialForm
// ---------------------------------------------------------------------------

export const CredentialForm = ({ initialData }: CredentialFormProps) => {
  const router = useRouter();
  const createCredential = useCreateCredential();
  const updateCredential = useUpdateCredential();
  const testCredential = useTestCredential();
  const { handleError, modal } = useUpgradeModal();

  const isEdit = !!initialData?.id;

  const defaultType = credentialDefsById.has(initialData?.type ?? "")
    ? (initialData?.type as string)
    : "apiKey";

  const resolver = zodResolver(
    buildFormSchema(isEdit) as unknown as never,
  ) as unknown as Resolver<FormValues, unknown, FormValues>;

  const form = useForm<FormValues, unknown, FormValues>({
    resolver,
    defaultValues: {
      name: initialData?.name ?? "",
      type: defaultType,
    },
  });

  const selectedType = form.watch("type");
  const def = credentialDefsById.get(selectedType) ?? credentialManifest[0];

  // Test connection state
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleTest = useCallback(async () => {
    if (!initialData?.id) return;
    setTestResult(null);
    const result = await testCredential.mutateAsync({ id: initialData.id });
    setTestResult(result);
  }, [initialData?.id, testCredential]);

  const onSubmit = async (values: FormValues) => {
    const payload: Record<string, string | undefined> = {
      name: values.name,
      type: values.type,
    };

    // Only include secret fields that have a value (edit mode: blank = keep)
    for (const fieldDef of def.fields) {
      const value = values[fieldDef.key];
      if (value && value.length > 0) {
        payload[fieldDef.key] = value;
      }
    }

    if (isEdit && initialData?.id) {
      await updateCredential.mutateAsync({
        id: initialData.id,
        ...payload,
      } as unknown as UpdateInput);
      // Clear test result since secrets may have changed
      setTestResult(null);
    } else {
      await createCredential.mutateAsync(payload as unknown as CreateInput, {
        onSuccess: (data) => {
          router.push(`/credentials/${data.id}`);
        },
        onError: (error) => {
          handleError(error);
        },
      });
    }
  };

  const isSaving = createCredential.isPending || updateCredential.isPending;

  return (
    <>
      {modal}
      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {isEdit ? "Edit Credential" : "Create Credential"}
              </CardTitle>
              <CardDescription>
                {isEdit
                  ? "Update your credential details"
                  : "Add a new credential to your account"}
              </CardDescription>
            </div>
            {isEdit && def.testable && (
              <div className="flex items-center gap-2">
                {testResult && <TestResultBadge result={testResult} />}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={testCredential.isPending}
                >
                  {testCredential.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plug2 className="size-4" />
                  )}
                  Test connection
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="My API key" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={isEdit}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pick a type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {credentialManifest.map((option) => (
                          <SelectItem key={option.type} value={option.type}>
                            <div className="flex items-center gap-2">
                              <Image
                                src={option.logo ?? "/logos/logo.svg"}
                                alt={option.label}
                                width={16}
                                height={16}
                              />
                              <span>{option.label}</span>
                              <span className="ml-1 text-muted-foreground">
                                {option.description}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>{def.description}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {def.fields.map((fieldDef) => {
                const editHint =
                  fieldDef.secret && isEdit
                    ? `Current value: ${initialData?.preview ?? "hidden"}. Leave blank to keep unchanged.`
                    : undefined;

                const createHint = fieldDef.optional
                  ? "Optional — leave blank to skip."
                  : fieldDef.secret
                    ? "Stored encrypted. You will only see a masked preview."
                    : undefined;

                const hint = isEdit ? editHint : createHint;

                return (
                  <FormField
                    key={fieldDef.key}
                    control={form.control}
                    name={fieldDef.key}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {fieldDef.label}
                          {!fieldDef.optional && !isEdit && <span> *</span>}
                        </FormLabel>
                        <FormControl>
                          {fieldDef.secret ? (
                            <SecretInput
                              placeholder={
                                isEdit
                                  ? "Enter new value to replace…"
                                  : fieldDef.placeholder
                              }
                              {...field}
                              value={field.value ?? ""}
                            />
                          ) : (
                            <Input
                              placeholder={fieldDef.placeholder}
                              autoComplete="off"
                              {...field}
                              value={field.value ?? ""}
                            />
                          )}
                        </FormControl>
                        {hint ? (
                          <FormDescription>{hint}</FormDescription>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                );
              })}

              <div className="flex items-center gap-4">
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="size-4 animate-spin" />}
                  {isEdit ? "Save changes" : "Create"}
                </Button>
                <Button type="button" variant="outline" asChild>
                  <Link href="/credentials" prefetch>
                    Cancel
                  </Link>
                </Button>
                {isEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="ml-auto text-destructive hover:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
      {isEdit && initialData?.id && (
        <DeleteCredentialDialog
          credentialId={initialData.id}
          credentialName={initialData.name}
          usageCount={initialData.usageCount ?? 0}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          navigateOnDelete
        />
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// CredentialView — loads a saved credential and renders the form
// ---------------------------------------------------------------------------

export const CredentialView = ({ credentialId }: { credentialId: string }) => {
  const { data: credential } = useSuspenseCredential(credentialId);

  return (
    <CredentialForm
      initialData={{
        id: credential.id,
        name: credential.name,
        type: credential.type,
        preview: credential.preview,
        usageCount: credential.usageCount,
      }}
    />
  );
};
