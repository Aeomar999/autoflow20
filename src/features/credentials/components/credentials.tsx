"use client";

import { formatDistanceToNow } from "date-fns";
import { KeyRoundIcon, MoreVerticalIcon, TrashIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useState } from "react";

import {
  DataTable,
  TableEmpty,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/dashboard/data-table";
import {
  Panel,
  PanelActions,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import {
  EmptyView,
  EntityContainer,
  EntityHeader,
  EntityPagination,
  EntitySearch,
  ErrorView,
} from "@/components/entity-components";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEntitySearch } from "@/hooks/use-entity-search";

import { credentialDefsById } from "../credential-types";
import {
  useCredentials,
  useSuspenseCredentials,
} from "../hooks/use-credentials";
import { useCredentialsParams } from "../hooks/use-credentials-params";
import type { CredentialPublic } from "../server/serialize";
import { DeleteCredentialDialog } from "./delete-credential-dialog";

const COLUMNS = 5;

export const CredentialsSearch = () => {
  const [params, setParams] = useCredentialsParams();
  const { searchValue, onSearchChange } = useEntitySearch({
    params,
    setParams,
  });

  return (
    <EntitySearch
      value={searchValue}
      onChange={onSearchChange}
      placeholder="Search credentials"
    />
  );
};

const CredentialsTableHead = () => (
  <THead>
    <tr>
      <TH>Credential</TH>
      <TH className="hidden md:table-cell">Secret</TH>
      <TH align="right" className="hidden lg:table-cell">
        Used by
      </TH>
      <TH className="hidden sm:table-cell">Updated</TH>
      <TH align="right">
        <span className="sr-only">Actions</span>
      </TH>
    </tr>
  </THead>
);

export const CredentialsList = () => {
  const credentials = useSuspenseCredentials();
  const items = credentials.data.items;

  return (
    <DataTable>
      <CredentialsTableHead />
      <TBody>
        {items.length === 0 ? (
          <TableEmpty colSpan={COLUMNS}>
            <CredentialsEmpty />
          </TableEmpty>
        ) : (
          items.map((credential) => (
            <CredentialRow key={credential.id} data={credential} />
          ))
        )}
      </TBody>
    </DataTable>
  );
};

export const CredentialsHeader = ({ disabled }: { disabled?: boolean }) => (
  <EntityHeader
    title="Credentials"
    description="Create and manage your credentials"
    newButtonHref="/credentials/new"
    newButtonLabel="New credential"
    disabled={disabled}
  />
);

export const CredentialsPagination = () => {
  const credentials = useCredentials();
  const [params, setParams] = useCredentialsParams();

  if (!credentials.data) return null;

  return (
    <EntityPagination
      disabled={credentials.isFetching}
      totalPages={credentials.data.totalPages}
      page={credentials.data.page}
      onPageChange={(page) => setParams({ ...params, page })}
    />
  );
};

export const CredentialsContainer = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <EntityContainer header={<CredentialsHeader />}>
    <Panel>
      <PanelHeader>
        <PanelTitle hint="Secrets are stored encrypted and never returned to the browser in full.">
          Stored credentials
        </PanelTitle>
        <PanelActions>
          <CredentialsSearch />
        </PanelActions>
      </PanelHeader>
      {children}
      <CredentialsPagination />
    </Panel>
  </EntityContainer>
);

export const CredentialsLoading = () => (
  <DataTable>
    <CredentialsTableHead />
    <TBody>
      <TableSkeleton columns={COLUMNS} />
    </TBody>
  </DataTable>
);

export const CredentialsError = () => (
  <ErrorView message="Error loading credentials" />
);

export const CredentialsEmpty = () => {
  const router = useRouter();

  return (
    <EmptyView
      icon={KeyRoundIcon}
      title="Connect your first service"
      message="Credentials let nodes authenticate to Slack, your database, or a model provider. They're encrypted with a per-credential key and decrypted only inside a running node — never returned to the browser, not even to you."
      onNew={() => router.push("/credentials/new")}
      actionLabel="Add a credential"
      secondaryAction={{
        label: "Start from a template",
        onClick: () => router.push("/templates"),
      }}
    />
  );
};

export const CredentialRow = memo(({ data }: { data: CredentialPublic }) => {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const logo = credentialDefsById.get(data.type)?.logo ?? "/logos/logo.svg";

  return (
    <>
      <TR href={`/credentials/${data.id}`}>
        <TD className="max-w-[280px]">
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-hairline bg-well">
              <Image src={logo} alt="" width={16} height={16} />
            </span>
            <div className="min-w-0">
              <Link
                href={`/credentials/${data.id}`}
                prefetch
                className="block truncate font-medium hover:text-primary hover:underline"
              >
                {data.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {data.type}
              </p>
            </div>
          </div>
        </TD>
        <TD className="hidden font-mono text-xs text-muted-foreground md:table-cell">
          {data.preview || "Hidden"}
        </TD>
        <TD
          align="right"
          className="hidden text-muted-foreground tabular-nums lg:table-cell"
        >
          {data.usageCount > 0
            ? `${data.usageCount} workflow${data.usageCount !== 1 ? "s" : ""}`
            : "Unused"}
        </TD>
        <TD className="hidden text-muted-foreground sm:table-cell">
          {formatDistanceToNow(data.updatedAt, { addSuffix: true })}
        </TD>
        <TD align="right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Actions for ${data.name}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <MoreVerticalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <TrashIcon className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TD>
      </TR>

      <DeleteCredentialDialog
        credentialId={data.id}
        credentialName={data.name}
        usageCount={data.usageCount}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
});
CredentialRow.displayName = "CredentialRow";
