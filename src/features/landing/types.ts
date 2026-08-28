export type ExecutionState = "idle" | "running" | "success" | "failed";

export type StepState = "pending" | "running" | "success" | "failed";

export interface MockNode {
  id: string;
  label: string;
  type: string;
  category: "TRIGGER" | "ACTION" | "LOGIC" | "AI" | "DATA";
  iconName: string;
  subtitle: string;
  position: { x: number; y: number };
  inputs?: string[];
  outputs?: string[];
  status?: StepState;
  durationMs?: number;
  configSummary?: Record<string, string>;
  inputPayload?: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;
  logs?: string[];
  credentialsRequired?: string;
}

export interface MockEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}

export interface MockWorkflowTemplate {
  id: string;
  name: string;
  tag: string;
  description: string;
  nodes: MockNode[];
  edges: MockEdge[];
  executionSequence: string[];
  totalLatency: string;
  estimatedCost: string;
}

export interface ConnectorInfo {
  id: string;
  name: string;
  category:
    | "AI"
    | "Triggers"
    | "Logic"
    | "Databases"
    | "Messaging"
    | "Commerce";
  description: string;
  iconSrc?: string;
  lucideIcon?: string;
  badgeText: string;
  ports: { inputs: number; outputs: number };
  popular?: boolean;
}
