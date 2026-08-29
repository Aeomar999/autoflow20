"use client";

import { useSetAtom } from "jotai";
import { PlusIcon } from "lucide-react";
import { memo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  appendSourceNodeIdAtom,
  nodeSelectorOpenAtom,
} from "@/features/editor/store/atoms";

export const AddNodeButton = memo(() => {
  const setSelectorOpen = useSetAtom(nodeSelectorOpenAtom);
  const setAppendSourceId = useSetAtom(appendSourceNodeIdAtom);

  const handleClick = useCallback(() => {
    setAppendSourceId(null);
    setSelectorOpen(true);
  }, [setAppendSourceId, setSelectorOpen]);

  return (
    <Button
      onClick={handleClick}
      size="icon"
      variant="outline"
      className="bg-background"
      aria-label="Add Node"
    >
      <PlusIcon />
    </Button>
  );
});

AddNodeButton.displayName = "AddNodeButton";
