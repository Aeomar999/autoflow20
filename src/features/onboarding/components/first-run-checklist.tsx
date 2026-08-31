"use client";

import {
  CheckCircle2Icon,
  CircleIcon,
  KeyRoundIcon,
  PlayIcon,
  SparklesIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { ONBOARDING_STEPS, type OnboardingStepId } from "../constants";
import {
  SAMPLE_TEMPLATE_SLUG,
  useCreateSampleWorkflow,
  useOnboarding,
} from "../hooks/use-onboarding";

const STEP_ICONS: Record<
  OnboardingStepId,
  React.ComponentType<{ className?: string }>
> = {
  workflow: WorkflowIcon,
  credential: KeyRoundIcon,
  run: PlayIcon,
};

/**
 * First-run checklist (AF-M7-05).
 *
 * Renders above the workflows list for a workspace that has not finished
 * setting itself up. Steps are ticked from real workspace data, not from
 * anything this component stores, so a tick always means the thing exists.
 */
export const FirstRunChecklist = () => {
  const router = useRouter();
  const { visible, steps, completedCount, dismiss } = useOnboarding();
  const createSample = useCreateSampleWorkflow();

  if (!visible) return null;

  const completeById = new Map(steps.map((step) => [step.id, step.complete]));

  return (
    <Card className="relative mb-6 border-dashed p-6">
      <Button
        variant="ghost"
        size="icon"
        onClick={dismiss}
        aria-label="Hide the setup checklist"
        className="absolute right-3 top-3 size-7 text-muted-foreground"
      >
        <XIcon className="size-4" />
      </Button>

      <div className="mb-5 pr-10">
        <h2 className="text-base font-semibold">Get your workspace running</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Three steps to your first recorded run.{" "}
          <span className="tabular-nums">
            {completedCount} of {steps.length} done.
          </span>
        </p>
      </div>

      <ol className="mb-5 space-y-3">
        {ONBOARDING_STEPS.map((step, index) => {
          const complete = completeById.get(step.id) ?? false;
          const Icon = STEP_ICONS[step.id];
          return (
            <li key={step.id} className="flex items-start gap-3">
              {complete ? (
                <CheckCircle2Icon
                  className="mt-0.5 size-5 shrink-0 text-green-600"
                  aria-hidden
                />
              ) : (
                <CircleIcon
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-sm font-medium",
                    complete && "text-muted-foreground line-through",
                  )}
                >
                  <span className="text-muted-foreground tabular-nums">
                    {index + 1}.
                  </span>{" "}
                  <Icon
                    className="mr-1 inline size-3.5 align-[-2px]"
                    aria-hidden
                  />
                  {step.title}
                  <span className="sr-only">
                    {complete ? " (done)" : " (not done)"}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {step.description}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => createSample.mutate({ slug: SAMPLE_TEMPLATE_SLUG })}
          disabled={createSample.isPending}
        >
          <SparklesIcon className="size-4" />
          {createSample.isPending ? "Installing…" : "Create a sample workflow"}
        </Button>
        <Button variant="outline" onClick={() => router.push("/templates")}>
          Browse templates
        </Button>
        <Button
          variant="outline"
          onClick={() => router.push("/credentials/new")}
        >
          Connect a credential
        </Button>
      </div>
    </Card>
  );
};
