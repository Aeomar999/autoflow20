"use client";

import { createId } from "@paralleldrive/cuid2";
import { useReactFlow } from "@xyflow/react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Bot,
  Database,
  GlobeIcon,
  MousePointerIcon,
  Webhook,
} from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { nodesAtom, saveStatusAtom } from "@/features/editor/store/atoms";
import { Separator } from "./ui/separator";

export type NodeTypeOption = {
  type: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }> | string;
};

const triggerNodes: NodeTypeOption[] = [
  {
    type: "MANUAL_TRIGGER",
    label: "Trigger manually",
    description:
      "Runs the flow on clicking a button. Good for getting started quickly",
    icon: MousePointerIcon,
  },
  {
    type: "GOOGLE_FORM_TRIGGER",
    label: "Google Form",
    description: "Runs the flow when a Google Form is submitted",
    icon: "/logos/googleform.svg",
  },
  {
    type: "STRIPE_TRIGGER",
    label: "Stripe Event",
    description: "Runs the flow when a Stripe Event is captured",
    icon: "/logos/stripe.svg",
  },
];

const executionNodes: NodeTypeOption[] = [
  {
    type: "HTTP_REQUEST",
    label: "HTTP Request",
    description: "Makes an HTTP request",
    icon: GlobeIcon,
  },
  {
    type: "GEMINI",
    label: "Gemini",
    description: "Uses Google Gemini to generate text",
    icon: "/logos/gemini.svg",
  },
  {
    type: "OPENAI",
    label: "OpenAI",
    description: "Uses OpenAI to generate text",
    icon: "/logos/openai.svg",
  },
  {
    type: "OPENAI_COMPATIBLE_CHAT",
    label: "OpenAI-Compatible",
    description: "Chat with any OpenAI-compatible endpoint",
    icon: Bot,
  },
  {
    type: "ANTHROPIC",
    label: "Anthropic",
    description: "Uses Anthropic to generate text",
    icon: "/logos/anthropic.svg",
  },
  {
    type: "DISCORD",
    label: "Discord",
    description: "Send a message to Discord",
    icon: "/logos/discord.svg",
  },
  {
    type: "SLACK",
    label: "Slack",
    description: "Send a message to Slack",
    icon: "/logos/slack.svg",
  },
  {
    type: "WEBHOOK_OUT",
    label: "Webhook",
    description: "Send a POST request to a webhook URL",
    icon: Webhook,
  },
  {
    type: "EMAIL_SEND",
    label: "Send Email",
    description: "Send an email through an SMTP relay",
    icon: "/logos/Logos/Email.png",
  },
  {
    type: "GOOGLE_SHEETS_APPEND",
    label: "Google Sheets",
    description: "Append rows to a Google Sheets spreadsheet",
    icon: "/logos/Logos/Google sheet.png",
  },
  {
    type: "AIRTABLE_CREATE_RECORD",
    label: "Airtable",
    description: "Create a record in an Airtable table",
    icon: "/logos/Logos/Airtable.png",
  },
  {
    type: "HUBSPOT_CREATE_CONTACT",
    label: "HubSpot",
    description: "Create a contact in HubSpot",
    icon: "/logos/Logos/Hubspot.png",
  },
  {
    type: "POSTGRES_QUERY",
    label: "Postgres Query",
    description: "Run a parameterized SQL query",
    icon: Database,
  },
];

interface NodeSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function NodeSelector({
  open,
  onOpenChange,
  children,
}: NodeSelectorProps) {
  const nodes = useAtomValue(nodesAtom);
  const setNodes = useSetAtom(nodesAtom);
  const setSaveStatus = useSetAtom(saveStatusAtom);

  const reactFlow = useReactFlow();

  const handleNodeSelect = useCallback(
    (selection: NodeTypeOption) => {
      if (selection.type === "MANUAL_TRIGGER") {
        const hasManualTrigger = nodes.some(
          (node) => node.type === "MANUAL_TRIGGER",
        );

        if (hasManualTrigger) {
          toast.error("Only one manual trigger is allowed per workflow");
          return;
        }
      }

      const hasInitialTrigger = nodes.some((node) => node.type === "INITIAL");

      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      const position = reactFlow.screenToFlowPosition({
        x: centerX,
        y: centerY,
      });

      const newNode = {
        id: createId(),
        type: selection.type,
        data: {},
        position: {
          x: position.x + (Math.random() - 0.5) * 200,
          y: position.y + (Math.random() - 0.5) * 200,
        },
      };

      if (hasInitialTrigger) {
        setNodes([newNode]);
      } else {
        setNodes((prev) => [...prev, newNode]);
      }
      setSaveStatus("unsaved");
      onOpenChange(false);
    },
    [nodes, setNodes, setSaveStatus, onOpenChange, reactFlow],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>What triggers this workflow?</SheetTitle>
          <SheetDescription>
            A trigger is a step that starts your workflow.
          </SheetDescription>
        </SheetHeader>
        <div>
          {triggerNodes.map((nodeType) => {
            const Icon = nodeType.icon;

            return (
              <button
                type="button"
                key={nodeType.type}
                className="block w-full justify-start h-auto py-5 px-4 rounded-none cursor-pointer border-l-2 border-transparent hover:border-l-primary text-left"
                onClick={() => handleNodeSelect(nodeType)}
              >
                <div className="flex items-center gap-6 w-full overflow-hidden">
                  {typeof Icon === "string" ? (
                    // biome-ignore lint/performance/noImgElement: SVG logos must bypass the Next image optimizer
                    <img
                      src={Icon}
                      alt={nodeType.label}
                      className="size-5 object-contain rounded-sm"
                    />
                  ) : (
                    <Icon className="size-5" />
                  )}
                  <div className="flex flex-col items-start text-left">
                    <span className="font-medium text-sm">
                      {nodeType.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {nodeType.description}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <Separator />
        <div>
          {executionNodes.map((nodeType) => {
            const Icon = nodeType.icon;

            return (
              <button
                type="button"
                key={nodeType.type}
                className="block w-full justify-start h-auto py-5 px-4 rounded-none cursor-pointer border-l-2 border-transparent hover:border-l-primary text-left"
                onClick={() => handleNodeSelect(nodeType)}
              >
                <div className="flex items-center gap-6 w-full overflow-hidden">
                  {typeof Icon === "string" ? (
                    // biome-ignore lint/performance/noImgElement: SVG logos must bypass the Next image optimizer
                    <img
                      src={Icon}
                      alt={nodeType.label}
                      className="size-5 object-contain rounded-sm"
                    />
                  ) : (
                    <Icon className="size-5" />
                  )}
                  <div className="flex flex-col items-start text-left">
                    <span className="font-medium text-sm">
                      {nodeType.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {nodeType.description}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
