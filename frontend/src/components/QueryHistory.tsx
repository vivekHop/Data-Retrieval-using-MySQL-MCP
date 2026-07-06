import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { AuditLog, UserSession } from '../types';
import { Terminal, Lock, Search, RefreshCw, CheckCircle, XCircle, Clock, Database, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

interface QueryHistoryProps {
  session: UserSession;
  isOpen: boolean;
  onClose: () => void;
}

export const QueryHistory: React.FC<QueryHistoryProps> = ({ session, isOpen, onClose }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLogs, setExpandedLogs] = useState<Record<number, boolean>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const isAdmin = session.role === 'admin';

  useEffect(() => {
    if (isOpen && isAdmin) {
      fetchLogs();
    }
  }, [isOpen]);

  const fetchLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getAuditLogs(100);
      setLogs(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopySql = (id: number, sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleLog = (id: number) => {
    setExpandedLogs((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  if (!isOpen) return null;

  const filteredLogs = logs.filter((log) => {
    const term = searchTerm.toLowerCase();
    return (
      log.question.toLowerCase().includes(term) ||
      (log.generated_sql && log.generated_sql.toLowerCase().includes(term)) ||
      log.user_id.toLowerCase().includes(term) ||
      (log.database_used && log.database_used.toLowerCase().includes(term))
    );
  });

  // Calculate quick stats
  const totalQueries = logs.length;
  const successQueries = logs.filter((l) => l.status === 'SUCCESS').length;
  const errorQueries = totalQueries - successQueries;
  const avgTime =
    totalQueries > 0
      ? Math.round(logs.reduce((acc, l) => acc + l.execution_time_ms, 0) / totalQueries)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-3xl h-full bg-brand-panel border-l border-brand-border flex flex-col shadow-2xl animate-slide-in">
        {/* Header */}
        <div className="p-4 border-b border-brand-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-brand-green" />
            <h2 className="text-lg font-bold text-white m-0">Query Execution Audit Trail</h2>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-brand-dark hover:bg-brand-border border border-brand-border rounded-lg text-xs font-semibold text-gray-400 hover:text-white cursor-pointer transition-all"
          >
            Close
          </button>
        </div>

        {/* Content Area */}
        {!isAdmin ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-brand-dark/10">
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-full mb-4">
              <Lock className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="text-white font-semibold text-base mb-1">Access Restricted</h3>
            <p className="text-gray-400 text-sm max-w-sm">
              The query audit trail contains sensitive database operational logs. 
              Only users with the <span className="text-red-400 font-semibold">admin</span> role are authorized to view these records.
            </p>
          </div>
        ) : (
          <>
            {/* Stats Bar */}
            <div className="grid grid-cols-4 gap-4 p-4 border-b border-brand-border bg-brand-dark/30">
              <div className="bg-brand-dark border border-brand-border/60 rounded-xl p-3 text-center">
                <span className="block text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-1">Total Queries</span>
                <span className="text-lg font-bold text-white">{totalQueries}</span>
              </div>
              <div className="bg-brand-dark border border-brand-border/60 rounded-xl p-3 text-center">
                <span className="block text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-1">Successful</span>
                <span className="text-lg font-bold text-brand-green">{successQueries}</span>
              </div>
              <div className="bg-brand-dark border border-brand-border/60 rounded-xl p-3 text-center">
                <span className="block text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-1">Failures</span>
                <span className="text-lg font-bold text-red-400">{errorQueries}</span>
              </div>
              <div className="bg-brand-dark border border-brand-border/60 rounded-xl p-3 text-center">
                <span className="block text-[10px] uppercase font-bold text-gray-500 tracking-wider mb-1">Avg Execution</span>
                <span className="text-lg font-bold text-blue-400">{avgTime}ms</span>
              </div>
            </div>

            {/* Filter and Refresh */}
            <div className="p-4 border-b border-brand-border flex gap-3 bg-brand-dark/10">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search logs by question, SQL, user, or database..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-brand-dark border border-brand-border rounded-xl text-white placeholder-gray-500 text-sm focus:outline-none focus:border-brand-green transition-all"
                />
              </div>
              <button
                onClick={fetchLogs}
                disabled={loading}
                className="px-3 bg-brand-dark hover:bg-brand-border border border-brand-border rounded-xl text-gray-400 hover:text-white transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span className="text-xs font-semibold">Reload</span>
              </button>
            </div>

            {/* Logs List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-brand-dark/20">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-48 text-gray-500 gap-2">
                  <RefreshCw className="w-8 h-8 animate-spin text-brand-green/60" />
                  <span className="text-sm">Fetching logs...</span>
                </div>
              ) : error ? (
                <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-center rounded-xl text-sm">
                  {error}
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm">
                  No log entries found.
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isExpanded = !!expandedLogs[log.id];
                  const formattedTime = new Date(log.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  });
                  const formattedDate = new Date(log.timestamp).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                  });

                  return (
                    <div
                      key={log.id}
                      className={`border rounded-xl overflow-hidden bg-brand-dark/40 border-brand-border hover:border-gray-700 transition-all ${
                        log.status === 'FAILURE' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-brand-green'
                      }`}
                    >
                      {/* Log Header */}
                      <div
                        onClick={() => toggleLog(log.id)}
                        className="p-3.5 flex items-start gap-3 cursor-pointer select-none"
                      >
                        <div className="mt-0.5">
                          {log.status === 'SUCCESS' ? (
                            <CheckCircle className="w-4 h-4 text-brand-green" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-gray-300">
                                {log.user_id}
                              </span>
                              <span className="text-[10px] text-gray-500">•</span>
                              <span className="text-[10px] font-medium text-gray-400 flex items-center gap-1">
                                <Database className="w-2.5 h-2.5" />
                                {log.database_used || 'system'}
                              </span>
                            </div>
                            <span className="text-[10px] text-gray-500 font-medium">
                              {formattedDate}, {formattedTime}
                            </span>
                          </div>
                          <p className="text-xs text-white font-medium line-clamp-2">
                            {log.question}
                          </p>
                        </div>

                        <div>
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-gray-500" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-gray-500" />
                          )}
                        </div>
                      </div>

                      {/* Log Details (Expanded) */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 border-t border-brand-border/40 bg-brand-dark/60 space-y-3.5 animate-slide-in">
                          {log.generated_sql && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                  Generated SQL Query
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopySql(log.id, log.generated_sql || '');
                                  }}
                                  className="p-1 bg-brand-panel hover:bg-brand-border border border-brand-border rounded-lg text-gray-400 hover:text-white transition-all cursor-pointer"
                                >
                                  {copiedId === log.id ? (
                                    <Check className="w-3 h-3 text-brand-green" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                              <pre className="p-3 bg-brand-dark border border-brand-border/50 rounded-xl text-[11px] font-mono text-emerald-400 overflow-x-auto">
                                {log.generated_sql}
                              </pre>
                            </div>
                          )}

                          {log.error_message && (
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
                                Error Log
                              </span>
                              <div className="p-3 bg-red-950/20 border border-red-500/20 text-red-400 rounded-xl text-[11px] font-mono whitespace-pre-wrap">
                                {log.error_message}
                              </div>
                            </div>
                          )}

                          <div className="flex items-center gap-4 text-[10px] text-gray-500 font-semibold uppercase tracking-wider pt-2 border-t border-brand-border/20">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Duration: <span className="text-gray-300 font-mono">{log.execution_time_ms.toFixed(2)}ms</span>
                            </span>
                            <span>•</span>
                            <span>Status: <span className={log.status === 'SUCCESS' ? 'text-brand-green' : 'text-red-400'}>{log.status}</span></span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
export default QueryHistory;
