import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { exportCsv, exportPdf, exportXlsx, type Column } from "@/lib/export";

export function ExportMenu<T>({ rows, columns, filename, title, subtitle, disabled }: {
  rows: T[];
  columns: Column<T>[];
  filename: string;
  title: string;
  subtitle?: string;
  disabled?: boolean;
}) {
  const run = (fn: () => unknown) => Promise.resolve(fn()).catch((e) => toast.error(`Export failed: ${(e as Error).message}`));
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled || rows.length === 0}>
          <Download /> Export
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end">
        <DropdownItem onSelect={() => run(() => exportCsv(rows, columns, filename))}>CSV</DropdownItem>
        <DropdownItem onSelect={() => run(() => exportXlsx(rows, columns, filename))}>Excel (.xlsx)</DropdownItem>
        <DropdownItem onSelect={() => run(() => exportPdf(rows, columns, filename, title, subtitle))}>PDF</DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
