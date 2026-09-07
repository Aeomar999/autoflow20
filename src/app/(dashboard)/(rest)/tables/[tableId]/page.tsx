"use client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTRPC } from "@/trpc/client";

export default function TableDetailPage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = use(params);
  const trpc = useTRPC();

  const { data: table, isLoading: tableLoading } = useQuery(
    trpc.tables.getTable.queryOptions({ id: tableId }),
  );
  const { data: records, isLoading: recordsLoading } = useQuery(
    trpc.tables.listRecords.queryOptions({ tableId }),
  );

  if (tableLoading || recordsLoading) {
    return <div className="p-8">Loading table...</div>;
  }

  if (!table) {
    return <div className="p-8 text-destructive">Table not found</div>;
  }

  const columns = (table.columns as any[]) || []; // biome-ignore lint/suspicious/noExplicitAny: json column

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-8 py-4 flex items-center justify-between bg-background">
        <div className="flex items-center gap-4">
          <Link href="/tables">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold">{table.name}</h1>
            <p className="text-sm text-muted-foreground">
              {table.description || "Workspace Table"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Settings className="mr-2 h-4 w-4" /> Schema
          </Button>
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" /> Add Row
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">ID</TableHead>
                {columns.map((col, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: order is stable
                  <TableHead key={i}>{col.name}</TableHead>
                ))}
                {columns.length === 0 && (
                  <TableHead className="text-muted-foreground italic">
                    No columns defined
                  </TableHead>
                )}
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records?.items?.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length + 2}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No records found.
                  </TableCell>
                </TableRow>
              ) : (
                records?.items?.map((record: any) => {
                  // biome-ignore lint/suspicious/noExplicitAny: json data
                  const data = (record.data as Record<string, any>) || {};
                  return (
                    <TableRow key={record.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {record.id.slice(-6)}
                      </TableCell>
                      {columns.map((col, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: order is stable
                        <TableCell key={i}>
                          {String(data[col.name] ?? "")}
                        </TableCell>
                      ))}
                      {columns.length === 0 && <TableCell />}
                      <TableCell className="text-right text-muted-foreground text-xs">
                        {format(new Date(record.createdAt), "MMM d, HH:mm")}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
