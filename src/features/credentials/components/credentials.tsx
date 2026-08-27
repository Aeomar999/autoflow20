"use client";

import { formatDistanceToNow } from "date-fns";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { memo, useState } from "react";
import {
  EmptyView,
  EntityContainer,
  EntityHeader,
  EntityItem,
  EntityList,
  EntityPagination,
  EntitySearch,
  ErrorView,
  LoadingView,
} from "@/components/entity-components";
import { useEntitySearch } from "@/hooks/use-entity-search";
import { credentialDefsById } from "../credential-types";
import {
  useCredentials,
  useSuspenseCredentials,
} from "../hooks/use-credentials";
import { useCredentialsParams } from "../hooks/use-credentials-params";
import type { CredentialPublic } from "../server/serialize";
import { DeleteCredentialDialog } from "./delete-credential-dialog";

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

export const CredentialsList = () => {
  const credentials = useSuspenseCredentials();

  return (
    <EntityList
      items={credentials.data.items}
      getKey={(credential) => credential.id}
      renderItem={(credential) => <CredentialItem data={credential} />}
      emptyView={<CredentialsEmpty />}
    />
  );
};

export const CredentialsHeader = ({ disabled }: { disabled?: boolean }) => {
  return (
    <EntityHeader
      title="Credentials"
      description="Create and manage your credentials"
      newButtonHref="/credentials/new"
      newButtonLabel="New credential"
      disabled={disabled}
    />
  );
};

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
}) => {
  return (
    <EntityContainer
      header={<CredentialsHeader />}
      search={<CredentialsSearch />}
      pagination={<CredentialsPagination />}
    >
      {children}
    </EntityContainer>
  );
};

export const CredentialsLoading = () => {
  return <LoadingView message="Loading credentials..." />;
};

export const CredentialsError = () => {
  return <ErrorView message="Error loading credentials" />;
};

export const CredentialsEmpty = () => {
  const router = useRouter();

  const handleCreate = () => {
    router.push(`/credentials/new`);
  };

  return (
    <EmptyView
      onNew={handleCreate}
      message="You haven't created any credentials yet. Get started by creating your first credential"
    />
  );
};

export const CredentialItem = memo(({ data }: { data: CredentialPublic }) => {
  const [deleteOpen, setDeleteOpen] = useState(false);

  const logo = credentialDefsById.get(data.type)?.logo ?? "/logos/logo.svg";

  const subtitle = (
    <>
      {data.preview && (
        <span className="font-mono text-xs">{data.preview}</span>
      )}
      {data.preview && " · "}
      Updated {formatDistanceToNow(data.updatedAt, { addSuffix: true })}
      {data.usageCount > 0 && (
        <>
          {" · "}
          <span className="text-muted-foreground">
            Used by {data.usageCount} workflow
            {data.usageCount !== 1 ? "s" : ""}
          </span>
        </>
      )}
    </>
  );

  return (
    <>
      <EntityItem
        href={`/credentials/${data.id}`}
        title={data.name}
        subtitle={subtitle}
        image={
          <div className="size-8 flex items-center justify-center">
            <Image src={logo} alt={data.type} width={20} height={20} />
          </div>
        }
        onRemove={() => setDeleteOpen(true)}
      />
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
