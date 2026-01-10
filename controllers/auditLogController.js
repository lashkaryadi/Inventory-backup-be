import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { DataTable, Column } from "@/components/common/DataTable";
import { Button } from "@/components/ui/button";
import api from "@/services/api";

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  user: string;
  createdAt: string;
}

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await api.getAuditLogs();
      setLogs(res.data || []);
    } catch (err) {
      console.error("Failed to fetch audit logs", err);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const columns: Column<AuditLog>[] = [
    {
      key: "action",
      header: "Action",
      render: (log) => (
        <span className="font-medium uppercase">{log.action}</span>
      ),
    },
    {
      key: "entity",
      header: "Entity",
      render: (log) => (
        <span className="capitalize">{log.entity}</span>
      ),
    },
    {
      key: "entityId",
      header: "Entity ID",
      render: (log) => (
        <span className="font-mono text-xs text-muted-foreground">
          {log.entityId}
        </span>
      ),
    },
    {
      key: "user",
      header: "User",
      render: (log) => log.user,
    },
    {
      key: "createdAt",
      header: "Date",
      render: (log) =>
        new Date(log.createdAt).toLocaleString(),
    },
  ];

  return (
    <MainLayout title="Audit Logs">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground">
            Track all critical system actions
          </p>

          <Button
            variant="outline"
            onClick={() => api.exportAuditLogsExcel()}
          >
            Export Excel
          </Button>
        </div>

        {/* Table */}
        <div className="royal-card">
          <DataTable
            columns={columns}
            data={logs}
            loading={loading}
            keyExtractor={(log) => log.id}
            emptyMessage="No audit logs found"
          />
        </div>
      </div>
    </MainLayout>
  );
}
