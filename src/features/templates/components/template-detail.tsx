"use client";

import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeftIcon,
  BoxesIcon,
  CheckCircle2Icon,
  KeyIcon,
  PlugIcon,
  UserIcon,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useInstallTemplate,
  useSuspenseTemplate,
} from "../hooks/use-templates";

const TemplateDetail = ({ slug }: { slug: string }) => {
  const template = useSuspenseTemplate(slug);

  return (
    <div className="mx-auto max-w-screen-xl w-full flex flex-col gap-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/templates"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          Templates
        </Link>
        <span>/</span>
        <span className="text-foreground">{template.data.name}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold leading-tight">
              {template.data.name}
            </h1>
            {template.data.featured && <Badge>Featured</Badge>}
            <Badge variant="secondary">{template.data.category}</Badge>
          </div>
          <p className="text-muted-foreground text-sm max-w-2xl">
            {template.data.description}
          </p>
          {template.data.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {template.data.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-y-1.5 text-sm text-muted-foreground border rounded-lg px-4 py-3 bg-muted/30">
          <span className="flex items-center gap-2">
            <UserIcon className="size-4" /> {template.data.author}
          </span>
          <span className="flex items-center gap-2">
            <BoxesIcon className="size-4" /> {template.data.nodeCount} nodes
          </span>
          <span className="flex items-center gap-2">
            <PlugIcon className="size-4" /> {template.data.credentialCount}{" "}
            credentials needed
          </span>
          <span className="flex items-center gap-2">
            {template.data.installs} installs · v{template.data.version}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 flex flex-col gap-y-6">
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base font-medium">
                What it does
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 flex flex-col gap-y-4">
              <p className="text-sm text-muted-foreground">
                {template.data.description}
              </p>
              <div className="flex flex-col gap-y-1.5">
                {template.data.nodeSummary.map((node) => (
                  <div
                    key={node.nodeId}
                    className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{node.nodeName}</span>
                    <span className="text-muted-foreground text-xs font-mono">
                      {node.nodeType}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Updated{" "}
                {formatDistanceToNow(template.data.updatedAt, {
                  addSuffix: true,
                })}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-y-6">
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base font-medium">
                Before you install
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 flex flex-col gap-y-2">
              <p className="text-sm text-muted-foreground">
                Connect the integrations this template uses. You can skip
                optional ones.
              </p>
              {template.data.pendingCredentials.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  <CheckCircle2Icon className="size-4" />
                  No credentials needed
                </div>
              ) : (
                template.data.pendingCredentials.map((credential) => (
                  <div
                    key={credential.nodeId + credential.credentialKey}
                    className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2"
                  >
                    <div className="flex flex-col gap-y-0.5 min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium truncate">
                        <KeyIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        {credential.credentialKey}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {credential.nodeName}
                        {credential.optional && (
                          <Badge variant="outline" className="text-[10px]">
                            optional
                          </Badge>
                        )}
                      </span>
                    </div>
                    <Button asChild size="sm" variant="outline" className="h-7">
                      <Link href="/credentials">Connect</Link>
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <InstallCard slug={slug} />
        </div>
      </div>
    </div>
  );
};

const InstallCard = ({ slug }: { slug: string }) => {
  const install = useInstallTemplate();

  return (
    <Card className="bg-primary text-primary-foreground border-primary">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base font-medium">Looks good?</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 flex flex-col gap-y-3">
        <p className="text-sm text-primary-foreground/80">
          Installs as a draft workflow. Connect any missing credentials, then
          deploy when you are ready.
        </p>
        <Button
          className="w-full bg-background text-foreground hover:bg-background/90"
          disabled={install.isPending}
          onClick={() => install.mutate({ slug })}
        >
          {install.isPending ? "Installing..." : "Install workflow"}
        </Button>
      </CardContent>
    </Card>
  );
};

export const TemplateDetailSkeleton = () => {
  return (
    <div className="mx-auto max-w-screen-xl w-full flex flex-col gap-y-8">
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="lg:col-span-2 h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-40 lg:col-start-2" />
      </div>
    </div>
  );
};

export default TemplateDetail;
