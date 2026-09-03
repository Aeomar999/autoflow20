"use client";

import { Position } from "@xyflow/react";
import { BaseHandle } from "@/components/react-flow/base-handle";
import { handleOffset, inputPorts, outputPorts } from "@/nodes/ports";

/**
 * Renders one React Flow handle per port the node type declares (AF-M9-03).
 *
 * The handle `id` is the `PortDef.id`, which is what `saveGraph` persists as
 * `Connection.fromOutput`/`toInput` and what the engine's `markTakenEdges`
 * compares against a branching node's `_outputPort`. Before this component the
 * canvas rendered a single hardcoded `source-1`/`target-1` pair, so a CONDITION's
 * `"true"`/`"false"` never matched any edge and its whole downstream was marked
 * `SKIPPED`. One component owns this so the three surfaces cannot drift again.
 *
 * A single port stays visually centred and unlabelled — single-port nodes render
 * exactly as they did before. Labels appear only where there is a choice to make.
 *
 * (AF-M9-09) `data` (the node's config) is threaded into `outputPorts` so
 * config-dependent nodes like SWITCH render exactly the ports their current
 * rules define. Omit it to get static ports only.
 */
export function NodePortHandles({
  type,
  data,
}: {
  type: string;
  data?: Record<string, unknown>;
}) {
  const inputs = inputPorts(type, data);
  const outputs = outputPorts(type, data);

  return (
    <>
      {inputs.map((port, index) => (
        <BaseHandle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          style={{ top: handleOffset(index, inputs.length) }}
          title={port.description ?? port.label}
          data-port-id={port.id}
        />
      ))}
      {inputs.length > 1 &&
        inputs.map((port, index) => (
          <PortLabel
            key={`label-${port.id}`}
            side="left"
            top={handleOffset(index, inputs.length)}
            label={port.label}
          />
        ))}

      {outputs.map((port, index) => (
        <BaseHandle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          style={{ top: handleOffset(index, outputs.length) }}
          title={port.description ?? port.label}
          data-port-id={port.id}
        />
      ))}
      {outputs.length > 1 &&
        outputs.map((port, index) => (
          <PortLabel
            key={`label-${port.id}`}
            side="right"
            top={handleOffset(index, outputs.length)}
            label={port.label}
          />
        ))}
    </>
  );
}

/**
 * Sits outside the node box so it never reflows the node itself, and is
 * `pointer-events-none` so it cannot steal a click meant for the handle.
 */
function PortLabel({
  side,
  top,
  label,
}: {
  side: "left" | "right";
  top: string;
  label: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute -translate-y-1/2 whitespace-nowrap text-[8px] leading-none text-muted-foreground ${
        side === "right" ? "left-full ml-2.5" : "right-full mr-2.5"
      }`}
      style={{ top }}
    >
      {label}
    </span>
  );
}
