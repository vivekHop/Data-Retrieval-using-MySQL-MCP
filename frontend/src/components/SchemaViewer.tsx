import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { DatabaseSchema } from '../types';
import {
  Database, Table2, Key, Link2, Search, RefreshCw, Zap,
  ChevronDown, ChevronRight, CheckSquare, Square,
  Folder, FolderOpen, AlertCircle, CheckCircle2, X
} from 'lucide-react';

interface SchemaViewerProps {
  selectedDatabases: string[];
  onSelectDatabases: (dbs: string[]) => void;
  connectionInfo: { connected: boolean; base_url: string | null; engine_type: string | null; database: string } | null;
  onConnectSuccess?: (info: any) => void;
  onOpenConnectionModal?: () => void;
}

type Toast = { id: number; type: 'success' | 'error' | 'info'; message: string };

export const SchemaViewer: React.FC<SchemaViewerProps> = ({
  selectedDatabases,
  onSelectDatabases,
  connectionInfo,
  onOpenConnectionModal,
}) => {
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<Record<string, DatabaseSchema>>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hardRefreshing, setHardRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [expandedDatabases, setExpandedDatabases] = useState<Record<string, boolean>>({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [toastCounter, setToastCounter] = useState(0);

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = useCallback((type: Toast['type'], message: string) => {
    const id = toastCounter + 1;
    setToastCounter(id);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, [toastCounter]);

  // ── Fetch databases when connected ────────────────────────────────────────
  useEffect(() => {
    if (connectionInfo?.connected) {
      fetchDatabases();
    } else {
      setDatabases([]);
      onSelectDatabases([]);
    }
  }, [connectionInfo]);

  // ── Load schemas for selected databases ───────────────────────────────────
  useEffect(() => {
    const loadMissingSchemas = async () => {
      let hasChanges = false;
      const updatedSchemas = { ...schemas };
      for (const db of selectedDatabases) {
        if (!updatedSchemas[db]) {
          try {
            updatedSchemas[db] = await api.getSchema(db);
            hasChanges = true;
          } catch (err) {
            console.error(`Failed to load schema for ${db}`, err);
          }
        }
      }
      if (hasChanges) setSchemas(updatedSchemas);
    };
    if (selectedDatabases.length > 0) loadMissingSchemas();
  }, [selectedDatabases]);

  // ── Auto-expand databases that match the search ───────────────────────────
  useEffect(() => {
    if (!searchTerm.trim()) return;
    const term = searchTerm.toLowerCase();
    const toExpand: Record<string, boolean> = {};
    for (const db of selectedDatabases) {
      const dbSchema = schemas[db] || {};
      const hasMatch = Object.entries(dbSchema).some(([tableName, tableMeta]) =>
        tableName.toLowerCase().includes(term) ||
        tableMeta.columns.some(c => c.name.toLowerCase().includes(term))
      );
      if (hasMatch) toExpand[db] = true;
    }
    setExpandedDatabases(prev => ({ ...prev, ...toExpand }));
  }, [searchTerm, schemas, selectedDatabases]);

  const fetchDatabases = async () => {
    setLoading(true);
    setError('');
    try {
      const dbs = await api.getDatabases();
      setDatabases(dbs);
      if (dbs.length > 0 && selectedDatabases.length === 0) {
        onSelectDatabases(dbs);
        setExpandedDatabases({ [dbs[0]]: true });
      }
    } catch {
      setError('Failed to fetch databases. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  // Reload details from manager (no force re-crawl)
  const handleReloadDetails = async () => {
    setRefreshing(true);
    try {
      setSchemas({});
      const dbs = await api.getDatabases();
      setDatabases(dbs);
      const reloadedSchemas: Record<string, DatabaseSchema> = {};
      for (const db of selectedDatabases) {
        if (dbs.includes(db)) {
          reloadedSchemas[db] = await api.getSchema(db);
        }
      }
      setSchemas(reloadedSchemas);
      showToast('success', 'Reloaded details from manager.');
    } catch (err: any) {
      showToast('error', err.message || 'Failed to reload details.');
    } finally {
      setRefreshing(false);
    }
  };

  // Hard refresh — purges shared cache, all clients get fresh schema
  const handleHardRefresh = async () => {
    setHardRefreshing(true);
    try {
      const result = await api.hardRefreshMetadata();
      const dbs = result.databases;
      setDatabases(dbs);
      const refreshedSchemas: Record<string, DatabaseSchema> = {};
      for (const db of selectedDatabases) {
        if (dbs.includes(db)) refreshedSchemas[db] = await api.getSchema(db);
      }
      setSchemas(refreshedSchemas);
      showToast('success', `Hard refresh complete. ${dbs.length} databases reloaded.`);
    } catch (err: any) {
      showToast('error', err.message || 'Hard refresh failed.');
    } finally {
      setHardRefreshing(false);
    }
  };

  const handleToggleDbCheckbox = (db: string) => {
    if (selectedDatabases.includes(db)) {
      if (selectedDatabases.length === 1) {
        showToast('info', 'At least one database must remain selected.');
        return;
      }
      onSelectDatabases(selectedDatabases.filter(d => d !== db));
    } else {
      onSelectDatabases([...selectedDatabases, db]);
      setExpandedDatabases(prev => ({ ...prev, [db]: true }));
    }
  };

  const handleSelectAllDbs = () => {
    onSelectDatabases(databases);
    const expanded: Record<string, boolean> = {};
    databases.forEach(db => { expanded[db] = true; });
    setExpandedDatabases(expanded);
  };

  const handleClearAllDbs = () => {
    if (databases.length > 0) onSelectDatabases([databases[0]]);
  };

  const toggleDbExpansion = (db: string) =>
    setExpandedDatabases(prev => ({ ...prev, [db]: !prev[db] }));

  const toggleTableExpansion = (key: string) =>
    setExpandedTables(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Filtered schema for tree ──────────────────────────────────────────────
  const getFilteredTables = (db: string) => {
    const dbSchema = schemas[db] || {};
    if (!searchTerm.trim()) return Object.entries(dbSchema);
    const term = searchTerm.toLowerCase();
    return Object.entries(dbSchema).filter(([tableName, tableMeta]) =>
      tableName.toLowerCase().includes(term) ||
      tableMeta.columns.some(c => c.name.toLowerCase().includes(term))
    );
  };

  const matchCount = searchTerm.trim()
    ? selectedDatabases.reduce((acc, db) => acc + getFilteredTables(db).length, 0)
    : null;

  return (
    <div className="flex flex-col h-full bg-brand-panel border-r border-brand-border relative">

      {/* ── Toast Stack ──────────────────────────────────────────────────── */}
      <div className="absolute top-2 right-2 z-50 space-y-2 w-[calc(100%-16px)]">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-start gap-2 p-2.5 rounded-xl border text-[11px] shadow-lg animate-slide-in ${
            t.type === 'success' ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300' :
            t.type === 'error' ? 'bg-red-950/60 border-red-500/30 text-red-300' :
            'bg-brand-dark/80 border-brand-border/40 text-gray-300'
          }`}>
            {t.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> :
             t.type === 'error' ? <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> :
             <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            <span className="flex-1 leading-tight">{t.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
              className="text-current opacity-50 hover:opacity-100 transition-opacity cursor-pointer">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="p-3 border-b border-brand-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-brand-green" />
            <span className="font-semibold text-sm tracking-wide text-white">Schema Explorer</span>
          </div>
          <div className="flex items-center gap-1">
            {/* Reload details from manager */}
            <button
              onClick={handleReloadDetails}
              disabled={refreshing || hardRefreshing || loading}
              title="Reload details from manager (Fast/Cached)"
              className="p-1.5 bg-brand-dark hover:bg-brand-border border border-brand-border rounded-lg text-gray-400 hover:text-brand-green disabled:opacity-40 transition-all cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-brand-green' : ''}`} />
            </button>
            {/* Hard refresh */}
            <button
              onClick={handleHardRefresh}
              disabled={hardRefreshing || refreshing || loading}
              title="Hard refresh — purge shared cache, reconnect &amp; re-crawl (Heavy)"
              className="p-1.5 bg-brand-dark hover:bg-brand-border border border-amber-500/30 rounded-lg text-amber-500/70 hover:text-amber-400 disabled:opacity-40 transition-all cursor-pointer"
            >
              <Zap className={`w-3.5 h-3.5 ${hardRefreshing ? 'animate-pulse text-amber-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Connection badge */}
        {connectionInfo?.connected ? (
          <div className="flex items-center justify-between px-2 py-1.5 bg-brand-green/5 border border-brand-green/15 rounded-lg">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="w-1.5 h-1.5 rounded-full bg-brand-green animate-pulse shrink-0" />
              <span className="text-[10px] text-brand-green font-mono truncate">
                {connectionInfo.engine_type?.toUpperCase()} · {connectionInfo.base_url}
              </span>
            </div>
            {onOpenConnectionModal && (
              <button
                onClick={onOpenConnectionModal}
                title="Switch JDBC connection"
                className="text-[9px] font-bold text-gray-500 hover:text-brand-green transition-colors uppercase tracking-wider ml-2 shrink-0 cursor-pointer"
              >
                Switch
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-red-950/30 border border-red-500/20 rounded-lg">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            <span className="text-[10px] text-red-400 font-medium">Not connected</span>
            {onOpenConnectionModal && (
              <button onClick={onOpenConnectionModal}
                className="ml-auto text-[9px] font-bold text-brand-green hover:text-white transition-colors cursor-pointer uppercase tracking-wider">
                Connect
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Database Checkboxes ───────────────────────────────────────────── */}
      <div className="p-3 border-b border-brand-border bg-brand-dark/10">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Databases ({databases.length})
          </label>
          <div className="flex gap-2">
            <button onClick={handleSelectAllDbs}
              className="text-[9px] font-bold text-brand-green hover:text-white uppercase transition-colors cursor-pointer">
              All
            </button>
            <span className="text-gray-700 text-[9px]">|</span>
            <button onClick={handleClearAllDbs}
              className="text-[9px] font-bold text-gray-500 hover:text-white uppercase transition-colors cursor-pointer">
              Min
            </button>
          </div>
        </div>
        {databases.length === 0 ? (
          <div className="text-[11px] text-gray-500 italic py-1">
            {loading ? 'Loading…' : 'No databases detected'}
          </div>
        ) : (
          <div className="max-h-28 overflow-y-auto space-y-1 pr-0.5 custom-scrollbar">
            {databases.map(db => {
              const isChecked = selectedDatabases.includes(db);
              return (
                <div key={db} onClick={() => handleToggleDbCheckbox(db)}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border cursor-pointer select-none transition-all ${
                    isChecked
                      ? 'bg-brand-green/8 border-brand-green/25 text-white'
                      : 'bg-brand-dark/30 border-brand-border/30 text-gray-400 hover:text-gray-300 hover:border-brand-border/60'
                  }`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Database className={`w-3 h-3 shrink-0 ${isChecked ? 'text-brand-green' : 'text-gray-600'}`} />
                    <span className="text-[11px] font-semibold uppercase tracking-wide truncate">{db}</span>
                  </div>
                  {isChecked
                    ? <CheckSquare className="w-3.5 h-3.5 text-brand-green shrink-0" />
                    : <Square className="w-3.5 h-3.5 text-gray-600 shrink-0" />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Search ───────────────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b border-brand-border bg-brand-dark/5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search tables or columns…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 bg-brand-dark/60 border border-brand-border rounded-lg text-gray-300 placeholder-gray-600 text-xs focus:outline-none focus:border-brand-green transition-all"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors cursor-pointer">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {matchCount !== null && (
          <p className="text-[10px] text-gray-500 mt-1 pl-0.5">
            {matchCount} table{matchCount !== 1 ? 's' : ''} matched
          </p>
        )}
      </div>

      {/* ── Schema Tree ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
        {loading && !refreshing ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-500 gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-brand-green/60" />
            <span className="text-[11px]">Loading schemas…</span>
          </div>
        ) : error ? (
          <div className="m-2 p-3 bg-red-950/30 border border-red-500/20 rounded-xl flex items-start gap-2 text-xs text-red-300">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : selectedDatabases.length === 0 ? (
          <div className="p-4 text-gray-500 text-xs text-center">
            Select at least one database above to view schema.
          </div>
        ) : (
          selectedDatabases.map(db => {
            const isDbExpanded = !!expandedDatabases[db];
            const filteredTables = getFilteredTables(db);
            const tableCount = Object.keys(schemas[db] || {}).length;
            const hasSchema = !!schemas[db];

            return (
              <div key={db} className="border border-brand-border/40 rounded-xl overflow-hidden">
                {/* Database folder header */}
                <button
                  onClick={() => toggleDbExpansion(db)}
                  className="w-full flex items-center justify-between p-2.5 bg-brand-dark/50 hover:bg-brand-dark/70 text-left cursor-pointer transition-colors group"
                >
                  <div className="flex items-center gap-2 text-white min-w-0">
                    {isDbExpanded
                      ? <FolderOpen className="w-3.5 h-3.5 text-brand-green shrink-0" />
                      : <Folder className="w-3.5 h-3.5 text-brand-green/60 shrink-0" />}
                    <span className="text-xs font-bold uppercase tracking-wider truncate">{db}</span>
                    {hasSchema && (
                      <span className="text-[9px] text-gray-500 font-mono shrink-0">
                        {tableCount}t
                      </span>
                    )}
                  </div>
                  {isDbExpanded
                    ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                </button>

                {isDbExpanded && (
                  <div className="p-1.5 space-y-0.5 bg-brand-dark/20 animate-slide-in">
                    {filteredTables.length === 0 ? (
                      <div className="text-[11px] text-gray-600 italic px-3 py-2">
                        {hasSchema
                          ? searchTerm ? 'No tables match your search' : 'No tables found'
                          : 'Loading schema…'}
                      </div>
                    ) : (
                      filteredTables.map(([tableName, tableMeta]) => {
                        const tableKey = `${db}.${tableName}`;
                        const isTableExpanded = !!expandedTables[tableKey];
                        const pkCount = tableMeta.columns.filter(c => c.is_primary).length;
                        const fkCount = tableMeta.columns.filter(c => c.is_foreign).length;

                        // Highlight matching columns when searching
                        const term = searchTerm.toLowerCase();
                        const highlightedColumns = searchTerm.trim()
                          ? tableMeta.columns.filter(c =>
                              c.name.toLowerCase().includes(term) || tableName.toLowerCase().includes(term)
                            )
                          : tableMeta.columns;

                        return (
                          <div key={tableName}
                            className="rounded-lg overflow-hidden border border-transparent hover:border-brand-border/40 transition-all">
                            <button
                              onClick={() => toggleTableExpansion(tableKey)}
                              className="w-full flex items-center justify-between px-2 py-1.5 text-left cursor-pointer group"
                            >
                              <div className="flex items-center gap-2 text-gray-300 group-hover:text-white transition-colors min-w-0">
                                <Table2 className="w-3 h-3 text-brand-green/50 group-hover:text-brand-green transition-colors shrink-0" />
                                <span className="text-xs font-medium truncate">{tableName}</span>
                                <span className="text-[9px] text-gray-600 font-mono shrink-0">
                                  {tableMeta.columns.length}c
                                  {pkCount > 0 && <span className="text-amber-600"> {pkCount}pk</span>}
                                  {fkCount > 0 && <span className="text-blue-600"> {fkCount}fk</span>}
                                </span>
                              </div>
                              {isTableExpanded
                                ? <ChevronDown className="w-3 h-3 text-gray-600 shrink-0" />
                                : <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />}
                            </button>

                            {isTableExpanded && (
                              <div className="pl-5 pr-2 pb-2 border-t border-brand-border/20 pt-1.5 bg-brand-dark/30 space-y-1 animate-slide-in">
                                {highlightedColumns.map(col => (
                                  <div key={col.name}
                                    className="flex items-center justify-between text-[11px] py-0.5 group/col">
                                    <div className="flex items-center gap-1 text-gray-400 group-hover/col:text-gray-200 transition-colors min-w-0">
                                      {col.is_primary && (
                                        <span title="Primary Key"><Key className="w-2.5 h-2.5 text-amber-400 shrink-0" /></span>
                                      )}
                                      {col.is_foreign && (
                                        <span title={`FK → ${col.referenced_table}.${col.referenced_column}`}><Link2 className="w-2.5 h-2.5 text-blue-400 shrink-0" /></span>
                                      )}
                                      <span className={`truncate ${
                                        col.is_primary ? 'text-amber-400/90 font-medium'
                                          : col.is_foreign ? 'text-blue-400/90'
                                          : ''
                                      }`}>
                                        {col.name}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-gray-600 font-mono ml-2 shrink-0">
                                      {col.type.split('(')[0]}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Footer legend ─────────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-t border-brand-border/30 bg-brand-dark/20 flex items-center gap-3 text-[9px] text-gray-600">
        <span className="flex items-center gap-1"><RefreshCw className="w-2.5 h-2.5" /> Soft refresh</span>
        <span className="flex items-center gap-1 text-amber-600/70"><Zap className="w-2.5 h-2.5" /> Hard refresh (all clients)</span>
      </div>
    </div>
  );
};
export default SchemaViewer;
