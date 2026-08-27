"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

type SecretInputProps = Omit<React.ComponentProps<"input">, "type">;

/** Password/secret input with an Eye/EyeOff visibility toggle. */
function SecretInput(props: SecretInputProps) {
  const [visible, setVisible] = useState<boolean>(false);

  return (
    <InputGroup>
      <InputGroupInput
        type={visible ? "text" : "password"}
        autoComplete="off"
        {...props}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          tabIndex={-1}
          aria-label={visible ? "Hide" : "Show"}
          onClick={() => setVisible((prev) => !prev)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

export { SecretInput };
