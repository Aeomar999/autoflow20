"use client";

import { FileUp, Globe, Loader2, Sparkles, Type, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCredentialsByType } from "@/features/credentials/hooks/use-credentials";
import {
  useCreateFileSource,
  useCreateTextSource,
  useCreateUrlSource,
} from "../hooks/use-knowledge-sources";

interface UploadSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadSourceDialog({
  open,
  onOpenChange,
}: UploadSourceDialogProps) {
  const [activeTab, setActiveTab] = useState<"file" | "url" | "text">("file");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");

  const [url, setUrl] = useState("");
  const [urlName, setUrlName] = useState("");

  const [textName, setTextName] = useState("");
  const [textContent, setTextContent] = useState("");

  const [credentialId, setCredentialId] = useState<string>("");

  const { data: openAiCredentials } = useCredentialsByType("openai.apiKey");

  const createFileMutation = useCreateFileSource();
  const createUrlMutation = useCreateUrlSource();
  const createTextMutation = useCreateTextSource();

  const isSubmitting =
    createFileMutation.isPending ||
    createUrlMutation.isPending ||
    createTextMutation.isPending;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!fileName) {
        setFileName(file.name.replace(/\.[^/.]+$/, ""));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (activeTab === "file") {
        if (!selectedFile) {
          toast.error("Please choose a file to upload");
          return;
        }

        const arrayBuffer = await selectedFile.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Content = btoa(binary);

        await createFileMutation.mutateAsync({
          name: fileName || selectedFile.name,
          base64Content,
          filename: selectedFile.name,
          credentialId: credentialId || undefined,
        });
      } else if (activeTab === "url") {
        if (!url) {
          toast.error("Please enter a valid webpage URL");
          return;
        }

        await createUrlMutation.mutateAsync({
          url,
          name: urlName || url,
          credentialId: credentialId || undefined,
        });
      } else if (activeTab === "text") {
        if (!textName || !textContent) {
          toast.error("Please provide both a name and text content");
          return;
        }

        await createTextMutation.mutateAsync({
          name: textName,
          content: textContent,
          credentialId: credentialId || undefined,
        });
      }

      setSelectedFile(null);
      setFileName("");
      setUrl("");
      setUrlName("");
      setTextName("");
      setTextContent("");
      onOpenChange(false);
    } catch {}
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <Upload className="size-5 text-primary" />
            Add Knowledge Source
          </DialogTitle>
          <DialogDescription className="text-sm">
            Ingest documents, webpages, or text snippets into your workspace
            vector database.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Tabs
            value={activeTab}
            onValueChange={(val) =>
              setActiveTab(val as "file" | "url" | "text")
            }
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger
                value="file"
                className="flex items-center gap-1.5 text-xs"
              >
                <FileUp className="size-3.5" />
                Upload File
              </TabsTrigger>
              <TabsTrigger
                value="url"
                className="flex items-center gap-1.5 text-xs"
              >
                <Globe className="size-3.5" />
                Webpage URL
              </TabsTrigger>
              <TabsTrigger
                value="text"
                className="flex items-center gap-1.5 text-xs"
              >
                <Type className="size-3.5" />
                Raw Text
              </TabsTrigger>
            </TabsList>

            <TabsContent value="file" className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="file-upload" className="text-xs font-medium">
                  Document (.pdf, .docx, .txt, .md)
                </Label>
                <Input
                  id="file-upload"
                  type="file"
                  accept=".pdf,.docx,.txt,.md,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileChange}
                  className="cursor-pointer"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="file-name" className="text-xs font-medium">
                  Source Name
                </Label>
                <Input
                  id="file-name"
                  placeholder="e.g. Q3 Financial Report"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                />
              </div>
            </TabsContent>

            <TabsContent value="url" className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="url-input" className="text-xs font-medium">
                  Webpage URL
                </Label>
                <Input
                  id="url-input"
                  type="url"
                  placeholder="https://docs.example.com/api-guide"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="url-name" className="text-xs font-medium">
                  Source Name (Optional)
                </Label>
                <Input
                  id="url-name"
                  placeholder="e.g. API Documentation"
                  value={urlName}
                  onChange={(e) => setUrlName(e.target.value)}
                />
              </div>
            </TabsContent>

            <TabsContent value="text" className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="text-name" className="text-xs font-medium">
                  Source Name
                </Label>
                <Input
                  id="text-name"
                  placeholder="e.g. Customer Support FAQ"
                  value={textName}
                  onChange={(e) => setTextName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="text-content" className="text-xs font-medium">
                  Content (Plain Text or Markdown)
                </Label>
                <Textarea
                  id="text-content"
                  placeholder="Paste your document content or FAQs here..."
                  rows={6}
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                />
              </div>
            </TabsContent>
          </Tabs>

          <div className="space-y-1.5 pt-2 border-t">
            <Label
              htmlFor="embedding-credential"
              className="text-xs font-medium flex items-center gap-1.5"
            >
              <Sparkles className="size-3.5 text-primary" />
              OpenAI Embedding Credential
            </Label>
            <Select value={credentialId} onValueChange={setCredentialId}>
              <SelectTrigger id="embedding-credential">
                <SelectValue placeholder="Use default OpenAI key or select credential" />
              </SelectTrigger>
              <SelectContent>
                {openAiCredentials?.items &&
                openAiCredentials.items.length > 0 ? (
                  openAiCredentials.items.map((cred) => (
                    <SelectItem key={cred.id} value={cred.id}>
                      {cred.name} {cred.preview ? `(${cred.preview})` : ""}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="default" disabled>
                    No registered OpenAI credentials (uses server default)
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Embeddings are computed with OpenAI{" "}
              <code>text-embedding-3-small</code> (1536d).
            </p>
          </div>

          <DialogFooter className="pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Processing…
                </>
              ) : (
                "Ingest & Embed"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
