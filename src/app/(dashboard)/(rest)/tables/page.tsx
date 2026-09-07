"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Table as TableIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTRPC } from "@/trpc/client";

export default function TablesPage() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const trpc = useTRPC();
  const router = useRouter();

  const { data: tables, isLoading } = useQuery(
    trpc.tables.listTables.queryOptions(),
  );

  const createTable = useMutation(
    trpc.tables.createTable.mutationOptions({
      onSuccess: (data) => {
        setIsCreateOpen(false);
        toast.success("Table created");
        router.push(`/tables/${data.id}`);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    if (!name) return;
    createTable.mutate({ name });
  };

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Workspace Tables
          </h1>
          <p className="text-muted-foreground">
            Manage native internal data tables for your workflows.
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Table
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Table</DialogTitle>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Table Name</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g. Customers"
                  required
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createTable.isPending}>
                  Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div>Loading...</div>
      ) : tables?.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-12 text-center">
          <TableIcon className="h-10 w-10 text-muted-foreground" />
          <h3 className="font-semibold">No tables</h3>
          <p className="text-sm text-muted-foreground">
            Get started by creating a new table.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tables?.map((table: any) => (
            <Link key={table.id} href={`/tables/${table.id}`}>
              <Card className="hover:border-primary/50 transition-colors">
                <CardHeader>
                  <CardTitle>{table.name}</CardTitle>
                  <CardDescription>
                    Created {format(new Date(table.createdAt), "MMM d, yyyy")}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
