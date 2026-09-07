"use client";
import { format } from "date-fns";
import { Plus, Table as TableIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
import { trpc } from "@/trpc/client";

export default function TablesPage() {
  const {
    data: tables,
    refetch,
    isLoading,
  } = trpc.tables.listTables.useQuery();
  const createTable = trpc.tables.createTable.useMutation({
    onSuccess: () => {
      setOpen(false);
      setName("");
      refetch();
    },
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const handleCreate = () => {
    if (!name) return;
    createTable.mutate({ name, columns: [] });
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

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Create Table
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Workspace Table</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Leads, Employees, Inventory"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={createTable.isPending || !name}
                onClick={handleCreate}
              >
                {createTable.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading tables...</div>
      ) : tables?.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <TableIcon className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">No tables yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mt-2">
            Workspace tables let you store and manage structured data directly
            inside AutoFlow without needing an external database.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tables?.map((table) => (
            <Link key={table.id} href={`/tables/${table.id}`}>
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TableIcon className="h-4 w-4" />
                    {table.name}
                  </CardTitle>
                  <CardDescription>
                    Created {format(new Date(table.createdAt), "MMM d, yyyy")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {
                      // biome-ignore lint/suspicious/noExplicitAny: json column
                      (table.columns as any[]).length
                    }{" "}
                    columns defined
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
