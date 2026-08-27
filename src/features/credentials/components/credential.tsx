"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type Resolver, useForm } from "react-hook-form";
import z from "zod";
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
  useUpdateCredential,
} from "../hooks/use-credentials";

/**
 * Form schema adapts to the currently selected credential type: the secret
 * object's shape is decided by the registry definition, never hard-coded.
 */
interface FormValues extends Record<string, string | undefined> {
  name: string;
  type: string;
}

const formSchema: z.ZodType<FormValues> = z
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
      if (!field.optional && !values[field.key]) {
        ctx.addIssue({
          code: "custom",
          path: [field.key],
          message: `${field.label} is required`,
        });
      }
    }
  });

interface CredentialFormProps {
  initialData?: {
    id?: string;
    name: string;
    type: string;
    preview?: string | null;
  };
}

const secretHints = (field: {
  key: string;
  label: string;
  secret: boolean;
  optional?: boolean;
}) =>
  field.optional
    ? "Optional — leave blank to skip."
    : field.secret
      ? "Stored encrypted. You will only see a masked preview."
      : undefined;

type CreateCredentialInput = Parameters<
  ReturnType<typeof useCreateCredential>["mutateAsync"]
>[0];
type UpdateCredentialInput = Parameters<
  ReturnType<typeof useUpdateCredential>["mutateAsync"]
>[0];

export const CredentialForm = ({ initialData }: CredentialFormProps) => {
  const router = useRouter();
  const createCredential = useCreateCredential();
  const updateCredential = useUpdateCredential();
  const { handleError, modal } = useUpgradeModal();

  const isEdit = !!initialData?.id;
  const defaultType = credentialDefsById.has(initialData?.type ?? "")
    ? (initialData?.type as string)
    : "apiKey";

  const resolver = zodResolver(
    formSchema as unknown as never,
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

  const onSubmit = async (values: FormValues) => {
    const secretFields: Record<string, string | undefined> = {};
    for (const fieldDef of def.fields) {
      const value = values[fieldDef.key];
      if (fieldDef.optional && !value) {
        continue;
      }
      if (value !== undefined) {
        secretFields[fieldDef.key] = value;
      }
    }

    const payload = { name: values.name, type: values.type, ...secretFields };

    if (isEdit && initialData?.id) {
      await updateCredential.mutateAsync({
        id: initialData.id,
        ...payload,
      } as unknown as UpdateCredentialInput);
    } else {
      await createCredential.mutateAsync(
        payload as unknown as CreateCredentialInput,
        {
          onSuccess: (data) => {
            router.push(`/credentials/${data.id}`);
          },
          onError: (error) => {
            handleError(error);
          },
        },
      );
    }
  };

  return (
    <>
      {modal}
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>
            {isEdit ? "Edit Credential" : "Create Credential"}
          </CardTitle>
          <CardDescription>
            {isEdit
              ? "Update your credential details"
              : "Add a new credential to your account"}
          </CardDescription>
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
                const hint =
                  fieldDef.secret && isEdit
                    ? `Current value: ${initialData?.preview ?? "hidden"}`
                    : secretHints(fieldDef);

                return (
                  <FormField
                    key={fieldDef.key}
                    control={form.control}
                    name={fieldDef.key}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {fieldDef.label}
                          {!fieldDef.optional && <span> *</span>}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type={fieldDef.secret ? "password" : "text"}
                            placeholder={fieldDef.placeholder}
                            autoComplete="off"
                            {...field}
                            value={field.value ?? ""}
                          />
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

              <div className="flex gap-4">
                <Button
                  type="submit"
                  disabled={
                    createCredential.isPending || updateCredential.isPending
                  }
                >
                  {isEdit ? "Update" : "Create"}
                </Button>
                <Button type="button" variant="outline" asChild>
                  <Link href="/credentials" prefetch>
                    Cancel
                  </Link>
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </>
  );
};

export const CredentialView = ({ credentialId }: { credentialId: string }) => {
  const { data: credential } = useSuspenseCredential(credentialId);

  return (
    <CredentialForm
      initialData={{
        id: credential.id,
        name: credential.name,
        type: credential.type,
        preview: credential.preview,
      }}
    />
  );
};
