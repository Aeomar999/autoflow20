"use client";

import { formatDistanceToNow } from "date-fns";
import { DownloadIcon, KeyIcon } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/dashboard/page";
import {
  Fact,
  Panel,
  PanelBody,
  PanelFacts,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import {
  useInstallTemplate,
  useSuspenseTemplate,
} from "../hooks/use-templates";

/**
 * Install lives in the page header and nowhere else. The previous layout had
 * an "Install workflow" card in the sidebar as well, which meant two controls
 * competing for the same decision on one screen.
 */
const InstallButton = ({ slug }: { slug: string }) => {
  const install = useInstallTemplate();

  return (
    <Button
      size="sm"
      disabled={install.isPending}
      onClick={() => install.mutate({ slug })}
    >
      <DownloadIcon className="size-4" />
      {install.isPending ? "Installing..." : "Install workflow"}
    </Button>
  );
};

const TemplateDetail = ({ slug }: { slug: string }) => {
  const template = useSuspenseTemplate(slug);
  const data = template.data;

  return (
    <>
      <PageHeader
        backTo={{ href: "/templates", label: "Templates" }}
        title={data.name}
        badge={
          <>
            {data.featured ? (
              <StatusPill tone="accent">Featured</StatusPill>
            ) : null}
            <StatusPill tone="neutral">{data.category}</StatusPill>
          </>
        }
        description={<p className="max-w-2xl">{data.description}</p>}
        actions={<InstallButton slug={slug} />}
      />

      <Panel>
        <PanelHeader>
          <PanelTitle>Template</PanelTitle>
          <span className="text-xs text-muted-foreground tabular-nums">
            Updated {formatDistanceToNow(data.updatedAt, { addSuffix: true })}
          </span>
        </PanelHeader>
        <PanelBody>
          <PanelFacts>
            <Fact label="Author">{data.author}</Fact>
            <Fact label="Version">
              <span className="font-mono text-sm">v{data.version}</span>
            </Fact>
            <Fact label="Installs">
              <span className="tabular-nums">
                {data.installs.toLocaleString()}
              </span>
            </Fact>
            <Fact label="Nodes">
              <span className="tabular-nums">{data.nodeCount}</span>
            </Fact>
            <Fact label="Credentials needed">
              <span className="tabular-nums">{data.credentialCount}</span>
            </Fact>
            {data.tags.length > 0 ? (
              <Fact label="Tags">
                <span className="flex flex-wrap gap-1.5">
                  {data.tags.map((tag) => (
                    <StatusPill key={tag} tone="neutral">
                      {tag}
                    </StatusPill>
                  ))}
                </span>
              </Fact>
            ) : null}
          </PanelFacts>
        </PanelBody>
      </Panel>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader>
            <PanelTitle hint="The nodes this template installs, in the order they were authored.">
              What it does
            </PanelTitle>
            <span className="text-xs text-muted-foreground tabular-nums">
              {data.nodeSummary.length}{" "}
              {data.nodeSummary.length === 1 ? "node" : "nodes"}
            </span>
          </PanelHeader>
          <ul className="divide-y divide-hairline">
            {data.nodeSummary.map((node) => (
              <li
                key={node.nodeId}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="truncate text-sm font-medium">
                  {node.nodeName}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {node.nodeType}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle hint="Installing works without these; the workflow just cannot run until they are connected.">
              Before you install
            </PanelTitle>
          </PanelHeader>

          {data.pendingCredentials.length === 0 ? (
            <PanelBody>
              <StatusPill tone="success">No credentials needed</StatusPill>
              <p className="mt-2 text-sm text-muted-foreground">
                This template runs as-is once installed.
              </p>
            </PanelBody>
          ) : (
            <ul className="divide-y divide-hairline">
              {data.pendingCredentials.map((credential) => (
                <li
                  key={credential.nodeId + credential.credentialKey}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <KeyIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      {credential.credentialKey}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      {credential.nodeName}
                      {credential.optional ? (
                        <StatusPill tone="neutral">optional</StatusPill>
                      ) : null}
                    </span>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 border-hairline bg-panel text-xs"
                  >
                    <Link href="/credentials">Connect</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
};

export const TemplateDetailSkeleton = () => (
  <>
    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-28" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>
    </div>
    <Skeleton className="h-32 rounded-xl" />
    <div className="grid gap-4 lg:grid-cols-3">
      <Skeleton className="h-64 rounded-xl lg:col-span-2" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  </>
);

export default TemplateDetail;
