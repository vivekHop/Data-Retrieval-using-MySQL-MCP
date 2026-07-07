import React, { useState, useRef, useEffect } from 'react';
import { api } from '../api';
import type { Message, UserSession } from '../types';
import { Send, Loader2, Database, Code, Table2, BarChart3, Copy, Check, Download, AlertCircle, Sparkles, MessageSquare, RefreshCw, Trash2 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface ChatWindowProps {
  session: UserSession;
  activeConversationId: string | null;
  selectedDatabases: string[];
  messages: Message[];
  onAddMessage: (msg: Message) => void;
  loading: boolean;
  setLoading: (l: boolean) => void;
  conversations: any[];
  connectionInfo: { connected: boolean; base_url: string | null; engine_type: string | null; database: string } | null;
  messagesLoading?: boolean;
  onReloadMessages?: () => void;
  onDeleteMessage?: (messageId: string) => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  session,
  activeConversationId,
  selectedDatabases,
  messages,
  onAddMessage,
  loading,
  setLoading,
  conversations,
  connectionInfo,
  messagesLoading = false,
  onReloadMessages,
  onDeleteMessage,
}) => {
  const [input, setInput] = useState('');
  const activeConversation = conversations.find(c => c.id === activeConversationId);
  const isUrlMismatch = activeConversation?.jdbc_url && connectionInfo?.connected && activeConversation.jdbc_url !== connectionInfo.base_url;

  const [copiedSqlIndex, setCopiedSqlIndex] = useState<number | null>(null);
  const [copiedTableIndex, setCopiedTableIndex] = useState<number | null>(null);
  const [activeViews, setActiveViews] = useState<Record<number, 'table' | 'chart'>>({});
  const [collapsedSql, setCollapsedSql] = useState<Record<string | number, boolean>>({});

  const [chartTypes, setChartTypes] = useState<Record<number, 'bar' | 'line' | 'area'>>({});

  // Real-time SSE timeline steps — populated as backend emits each step
  const [liveSteps, setLiveSteps] = useState<{ title: string; description: string; status: string }[]>([]);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(-1);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages or steps change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, liveSteps]);

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim() || loading) return;

    // 1. Immediately add the user message to the UI
    const userMsg: Message = {
      id: Math.random().toString(),
      role: 'user',
      text: textToSend,
      timestamp: new Date().toISOString(),
    };
    onAddMessage(userMsg);
    setInput('');
    setLoading(true);

    // 2. Reset live timeline
    setLiveSteps([]);
    setActiveStepIndex(-1);

    const conversationId = activeConversationId || 'chat_session_' + session.username;

    try {
      let finalResult: any = null;
      let errorMsg: string | null = null;

      await api.askQuestionStream(
        textToSend,
        selectedDatabases.length > 0 ? selectedDatabases : undefined,
        conversationId,
        // onStep: push each step as it arrives from the backend
        (step) => {
          setLiveSteps(prev => {
            const next = [...prev, { ...step, status: 'completed' }];
            setActiveStepIndex(next.length - 1);
            return next;
          });
        },
        // onResult: build assistant message
        (result) => { finalResult = result; },
        // onError
        (msg) => { errorMsg = msg; },
      );

      if (finalResult) {
        const assistantMsg: Message = {
          id: Math.random().toString(),
          role: 'assistant',
          text: finalResult.summary || 'Query executed successfully.',
          sql: finalResult.sql,
          columns: finalResult.columns,
          rows: finalResult.rows,
          executionTimeMs: finalResult.execution_time_ms,
          rowCount: finalResult.row_count,
          database: finalResult.database_used,
          error: finalResult.error,
          suggestedQuestions: finalResult.suggested_questions,
          geminiCallsCount: finalResult.gemini_calls_count,
          steps: finalResult.steps,
          timestamp: new Date().toISOString(),
        };
        onAddMessage(assistantMsg);
      } else {
        const errMsg2: Message = {
          id: Math.random().toString(),
          role: 'assistant',
          text: 'I encountered an error while processing your request.',
          error: errorMsg || 'Unknown error from AI pipeline.',
          timestamp: new Date().toISOString(),
        };
        onAddMessage(errMsg2);
      }
    } catch (err: any) {
      const errMsg: Message = {
        id: Math.random().toString(),
        role: 'assistant',
        text: 'I encountered an error while processing your request.',
        error: err.message || 'Unknown connection error.',
        timestamp: new Date().toISOString(),
      };
      onAddMessage(errMsg);
    } finally {
      setLoading(false);
      // Keep the completed steps visible for a moment then clear
      setTimeout(() => {
        setLiveSteps([]);
        setActiveStepIndex(-1);
      }, 3000);
    }
  };


  const handleCopySql = (index: number, sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedSqlIndex(index);
    setTimeout(() => setCopiedSqlIndex(null), 2000);
  };

  const handleCopyTableData = (index: number, columns: string[], rows: any[][]) => {
    // Format as Tab Separated Values (TSV) for easy pasting into Excel
    const headerRow = columns.join('\t');
    const dataRows = rows.map((r) => r.join('\t')).join('\n');
    const fullText = `${headerRow}\n${dataRows}`;

    navigator.clipboard.writeText(fullText);
    setCopiedTableIndex(index);
    setTimeout(() => setCopiedTableIndex(null), 2000);
  };

  const handleExportCsv = (columns: string[], rows: any[][], tableName = 'query_results') => {
    const csvContent = [
      columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(','),
      ...rows.map((row) =>
        row
          .map((val) => {
            const strVal = val === null || val === undefined ? '' : String(val);
            return `"${strVal.replace(/"/g, '""')}"`;
          })
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${tableName}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleSqlCollapse = (index: number) => {
    setCollapsedSql((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  // Determine if a message dataset can be charted
  const getChartConfig = (columns?: string[] | null, rows?: any[][] | null) => {
    if (!columns || !rows || rows.length < 2 || columns.length < 2) return null;

    // Helper to check if a column is mostly numeric
    const isColumnNumeric = (colIndex: number) => {
      let numericCount = 0;
      let totalCount = 0;
      for (const row of rows) {
        const val = row[colIndex];
        if (val === null || val === undefined || val === '') continue;
        totalCount++;
        if (!isNaN(Number(val))) {
          numericCount++;
        }
      }
      return totalCount > 0 && (numericCount / totalCount) >= 0.8;
    };

    const numericIndices: number[] = [];
    const nonNumericIndices: number[] = [];

    for (let i = 0; i < columns.length; i++) {
      if (isColumnNumeric(i)) {
        numericIndices.push(i);
      } else {
        nonNumericIndices.push(i);
      }
    }

    let categoryColIndex = -1;
    let valueColIndex = -1;

    if (numericIndices.length > 0) {
      valueColIndex = numericIndices[0];

      if (nonNumericIndices.length > 0) {
        categoryColIndex = nonNumericIndices[0];
      } else if (numericIndices.length > 1) {
        categoryColIndex = numericIndices[0];
        valueColIndex = numericIndices[1];
      } else {
        categoryColIndex = 0;
        valueColIndex = 0;
      }
    }

    if (categoryColIndex === valueColIndex && columns.length >= 2) {
      categoryColIndex = 0;
      valueColIndex = 1;
    }

    if (valueColIndex !== -1 && categoryColIndex !== -1 && categoryColIndex !== valueColIndex) {
      const data = rows.map((row) => ({
        name: String(row[categoryColIndex] === null || row[categoryColIndex] === undefined ? 'NULL' : row[categoryColIndex]),
        value: Number(row[valueColIndex] || 0),
      }));
      return {
        data,
        xAxisName: columns[categoryColIndex],
        yAxisName: columns[valueColIndex],
      };
    }

    return null;
  };

  const renderSimpleMarkdown = (text: string) => {
    // Basic formatting for double stars **bold**
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      // Check if it's a bullet point
      const isBullet = line.trim().startsWith('* ') || line.trim().startsWith('- ');
      let content = line;
      if (isBullet) {
        content = line.trim().substring(2);
      }

      // Regex replace **bold**
      const formatted = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

      if (isBullet) {
        return (
          <li key={idx} className="ml-4 list-disc text-sm text-gray-300 leading-relaxed mb-1" dangerouslySetInnerHTML={{ __html: formatted }} />
        );
      }
      return (
        <p key={idx} className="text-sm text-gray-300 leading-relaxed mb-2.5" dangerouslySetInnerHTML={{ __html: formatted }} />
      );
    });
  };

  const highlightSql = (sql: string) => {
    // Very simple syntax highlighting for display
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'GROUP BY', 'ORDER BY', 
      'LIMIT', 'WITH', 'AS', 'AND', 'OR', 'SUM', 'COUNT', 'AVG', 'LEFT JOIN', 'INNER JOIN'
    ];
    let highlighted = sql;
    keywords.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      highlighted = highlighted.replace(regex, `<span class="text-emerald-400 font-bold">${keyword.toUpperCase()}</span>`);
    });
    return highlighted;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-brand-dark relative overflow-hidden">
      {/* Header bar */}
      <div className="px-6 py-3.5 bg-brand-panel border-b border-brand-border flex items-center justify-between z-10 shadow-sm shadow-black/5 animate-slide-in">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-brand-green/10 border border-brand-green/20 flex items-center justify-center text-brand-green shrink-0">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-white truncate">
              {activeConversation?.title || 'No Conversation Selected'}
            </h3>
            {connectionInfo && (
              <p className="text-[9px] text-gray-500 font-mono mt-0.5 truncate uppercase tracking-wider">
                Target Source · {connectionInfo.engine_type || 'JDBC'}
              </p>
            )}
          </div>
        </div>

        {activeConversationId && onReloadMessages && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onReloadMessages}
              title="Reload all messages for this chat"
              className="px-3 py-1.5 bg-brand-dark hover:bg-brand-border border border-brand-border rounded-xl text-gray-400 hover:text-white transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-bold"
            >
              <RefreshCw className={`w-3 h-3 ${loading || messagesLoading ? 'animate-spin text-brand-green' : ''}`} />
              Sync Messages
            </button>
          </div>
        )}
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messagesLoading ? (
          <div className="space-y-6 animate-pulse">
            <div className="flex gap-4 justify-end">
              <div className="max-w-md w-full space-y-2">
                <div className="h-3.5 bg-brand-border/60 rounded-xl w-3/4 ml-auto" />
                <div className="h-10 bg-brand-green/20 rounded-2xl w-full" />
              </div>
            </div>
            <div className="flex gap-4 justify-start">
              <div className="w-8 h-8 rounded-lg bg-brand-border/40 shrink-0" />
              <div className="max-w-xl w-full space-y-3">
                <div className="h-3.5 bg-brand-border/60 rounded-xl w-1/4" />
                <div className="h-24 bg-brand-panel border border-brand-border/60 rounded-2xl w-full" />
              </div>
            </div>
            <div className="flex gap-4 justify-end">
              <div className="max-w-md w-full space-y-2">
                <div className="h-3.5 bg-brand-border/60 rounded-xl w-1/2 ml-auto" />
                <div className="h-10 bg-brand-green/20 rounded-2xl w-full" />
              </div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto space-y-8 animate-slide-in">
            <div className="space-y-3">
              <div className="inline-flex items-center justify-center p-3.5 bg-brand-green/10 rounded-2xl border border-brand-green/20 glow-green">
                <Sparkles className="w-10 h-10 text-brand-green" />
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Enterprise SQL Assistant</h2>
              <p className="text-gray-400 text-sm">
                Ask questions about your sales, finance, inventory, or HR databases. 
                The AI agent will analyze schemas, formulate SQL queries, and retrieve visual reports securely.
              </p>
            </div>

            {/* Quick Connections Indicator */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-brand-green/5 border border-brand-green/20 rounded-full text-xs text-brand-green font-medium">
              <span className="w-2 h-2 rounded-full bg-brand-green animate-pulse" />
              Connected to active MySQL connections (Sales, Finance, Inventory, HR)
            </div>

            {/* Suggestions cards */}
            <div className="grid grid-cols-2 gap-3 w-full text-left">
              <button
                onClick={() => handleSend('Show top 10 customers by revenue this month')}
                className="p-4 bg-brand-panel hover:bg-brand-border/60 border border-brand-border rounded-xl text-left hover:border-brand-green/30 transition-all cursor-pointer group"
              >
                <span className="block text-[10px] font-bold text-brand-green uppercase tracking-wider mb-1">Sales Schema</span>
                <p className="text-xs text-gray-300 group-hover:text-white transition-colors">
                  "Show top 10 customers by revenue this month"
                </p>
              </button>
              <button
                onClick={() => handleSend('List employees in Sales department earning more than 50000')}
                className="p-4 bg-brand-panel hover:bg-brand-border/60 border border-brand-border rounded-xl text-left hover:border-brand-green/30 transition-all cursor-pointer group"
              >
                <span className="block text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-1">HR Schema</span>
                <p className="text-xs text-gray-300 group-hover:text-white transition-colors">
                  "List high earners in Sales department"
                </p>
              </button>
              <button
                onClick={() => handleSend('Get total inventory value by product category')}
                className="p-4 bg-brand-panel hover:bg-brand-border/60 border border-brand-border rounded-xl text-left hover:border-brand-green/30 transition-all cursor-pointer group"
              >
                <span className="block text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">Inventory Schema</span>
                <p className="text-xs text-gray-300 group-hover:text-white transition-colors">
                  "Get total stock value by product category"
                </p>
              </button>
              <button
                onClick={() => handleSend('List all unpaid invoices')}
                className="p-4 bg-brand-panel hover:bg-brand-border/60 border border-brand-border rounded-xl text-left hover:border-brand-green/30 transition-all cursor-pointer group"
              >
                <span className="block text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1">Finance Schema</span>
                <p className="text-xs text-gray-300 group-hover:text-white transition-colors">
                  "List all unpaid invoice balances"
                </p>
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isAssistant = msg.role === 'assistant';
            const isViewChart = activeViews[idx] === 'chart';
            const isSqlCollapsed = collapsedSql[idx] !== false; // Default: collapsed (true)
            const chartConfig = getChartConfig(msg.columns, msg.rows);

            return (
              <div
                key={msg.id}
                className={`flex gap-4 animate-slide-in ${
                  isAssistant ? 'justify-start' : 'justify-end'
                }`}
              >
                {/* Assistant Logo */}
                {isAssistant && (
                  <div className="w-8 h-8 rounded-lg bg-brand-green/10 border border-brand-green/20 flex items-center justify-center shrink-0 text-brand-green">
                    <Sparkles className="w-4 h-4" />
                  </div>
                )}

                <div className={`max-w-2xl space-y-3 ${isAssistant ? 'w-full' : ''}`}>
                  {/* Message bubble */}
                  <div
                    className={`rounded-2xl p-4.5 relative ${
                      isAssistant
                        ? 'bg-brand-panel border border-brand-border shadow-md group/asst-bubble'
                        : 'bg-brand-green text-brand-dark font-medium shadow-md group/user-bubble'
                    }`}
                  >
                    {/* Delete specific message button */}
                    {onDeleteMessage && (
                      <button
                        type="button"
                        onClick={() => onDeleteMessage(msg.id)}
                        className={`absolute top-2.5 right-2.5 opacity-0 transition-all duration-200 p-1 rounded-lg cursor-pointer z-20 ${
                          isAssistant
                            ? 'group-hover/asst-bubble:opacity-100 bg-brand-dark/50 hover:bg-brand-dark text-gray-500 hover:text-red-400 border border-brand-border'
                            : 'group-hover/user-bubble:opacity-100 bg-brand-dark/10 hover:bg-brand-dark/20 text-brand-dark hover:text-red-700'
                        }`}
                        title="Delete Message"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {!isAssistant ? (
                      <p className="text-sm m-0 leading-relaxed pr-6">{msg.text}</p>
                    ) : (
                      <div className="space-y-4">
                        {/* Summary response text */}
                        {!msg.error && (
                          <div className="prose prose-invert max-w-none">
                            {renderSimpleMarkdown(msg.text)}
                          </div>
                        )}

                        {/* Error state */}
                        {msg.error && (
                          <div className="p-3 bg-red-950/20 border border-red-500/20 rounded-xl text-red-400 text-xs flex gap-2 items-start animate-shake">
                            <AlertCircle className="w-4.5 h-4.5 shrink-0 text-red-500" />
                            <div className="font-mono font-semibold tracking-wide whitespace-pre-wrap">{msg.error}</div>
                          </div>
                        )}

                        {/* SQL block (collapsible) */}
                        {msg.sql && (
                          <div className="border border-brand-border/60 bg-brand-dark/40 rounded-xl overflow-hidden">
                            <button
                              onClick={() => toggleSqlCollapse(idx)}
                              className="w-full px-3.5 py-2.5 bg-brand-dark/60 hover:bg-brand-dark flex items-center justify-between border-b border-brand-border/40 text-left cursor-pointer transition-colors"
                            >
                              <div className="flex items-center gap-2 text-gray-400">
                                <Code className="w-3.5 h-3.5 text-brand-green" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Generated SQL Query</span>
                              </div>
                              <span className="text-[10px] text-gray-500 font-semibold">
                                {isSqlCollapsed ? 'Expand' : 'Collapse'}
                              </span>
                            </button>

                            {!isSqlCollapsed && (
                              <div className="p-3 bg-brand-dark/90 relative">
                                <button
                                  onClick={() => handleCopySql(idx, msg.sql || '')}
                                  className="absolute top-2.5 right-2.5 p-1 bg-brand-panel hover:bg-brand-border border border-brand-border rounded-lg text-gray-400 hover:text-white transition-colors cursor-pointer"
                                >
                                  {copiedSqlIndex === idx ? (
                                    <Check className="w-3.5 h-3.5 text-brand-green" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <pre
                                  className="text-[11px] font-mono text-gray-200 overflow-x-auto whitespace-pre-wrap pr-8"
                                  dangerouslySetInnerHTML={{ __html: highlightSql(msg.sql) }}
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Data Results Grid (Table or Chart) */}
                        {msg.columns && msg.rows && msg.rows.length > 0 && (
                          <div className="border border-brand-border/60 bg-brand-dark/20 rounded-xl overflow-hidden">
                            {/* Toolbar header */}
                            <div className="px-3.5 py-2 bg-brand-dark/50 flex items-center justify-between border-b border-brand-border/40 text-xs">
                              <div className="flex items-center gap-4">
                                <span className="text-gray-400 font-medium">
                                  {msg.rowCount} rows retrieved
                                </span>
                                <span className="text-gray-600 font-medium">|</span>
                                <span className="text-gray-400 font-medium font-mono">
                                  {msg.executionTimeMs?.toFixed(1)}ms
                                </span>
                                {msg.geminiCallsCount !== undefined && msg.geminiCallsCount > 0 && (
                                  <>
                                    <span className="text-gray-600 font-medium">|</span>
                                    <span className="text-gray-400 font-medium">
                                      {msg.geminiCallsCount} Gemini {msg.geminiCallsCount === 1 ? 'call' : 'calls'}
                                    </span>
                                  </>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5">
                                {/* Toggle views */}
                                {chartConfig && (
                                  <div className="flex items-center gap-1.5 mr-2">
                                    <div className="bg-brand-panel border border-brand-border/60 p-0.5 rounded-lg flex gap-0.5 animate-slide-in">
                                      <button
                                        type="button"
                                        onClick={() => setActiveViews((prev) => ({ ...prev, [idx]: 'table' }))}
                                        className={`p-1 rounded-md transition-all cursor-pointer ${
                                          !isViewChart
                                            ? 'bg-brand-border text-brand-green animate-pulse-subtle'
                                            : 'text-gray-500 hover:text-gray-300'
                                        }`}
                                        title="Table View"
                                      >
                                        <Table2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setActiveViews((prev) => ({ ...prev, [idx]: 'chart' }))}
                                        className={`p-1 rounded-md transition-all cursor-pointer ${
                                          isViewChart
                                            ? 'bg-brand-border text-brand-green animate-pulse-subtle'
                                            : 'text-gray-500 hover:text-gray-300'
                                        }`}
                                        title="Chart View"
                                      >
                                        <BarChart3 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>

                                    {isViewChart && (
                                      <div className="bg-brand-panel border border-brand-border/60 p-0.5 rounded-lg flex gap-0.5 animate-slide-in">
                                        <button
                                          type="button"
                                          onClick={() => setChartTypes((prev) => ({ ...prev, [idx]: 'bar' }))}
                                          className={`px-1.5 py-0.5 text-[9px] font-bold rounded-md transition-all cursor-pointer ${
                                            (chartTypes[idx] || 'bar') === 'bar'
                                              ? 'bg-brand-border text-brand-green'
                                              : 'text-gray-500 hover:text-gray-300'
                                          }`}
                                          title="Bar Chart"
                                        >
                                          Bar
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setChartTypes((prev) => ({ ...prev, [idx]: 'line' }))}
                                          className={`px-1.5 py-0.5 text-[9px] font-bold rounded-md transition-all cursor-pointer ${
                                            chartTypes[idx] === 'line'
                                              ? 'bg-brand-border text-brand-green'
                                              : 'text-gray-500 hover:text-gray-300'
                                          }`}
                                          title="Line Chart"
                                        >
                                          Line
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setChartTypes((prev) => ({ ...prev, [idx]: 'area' }))}
                                          className={`px-1.5 py-0.5 text-[9px] font-bold rounded-md transition-all cursor-pointer ${
                                            chartTypes[idx] === 'area'
                                              ? 'bg-brand-border text-brand-green'
                                              : 'text-gray-500 hover:text-gray-300'
                                          }`}
                                          title="Area Chart"
                                        >
                                          Area
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* CSV Export */}
                                <button
                                  onClick={() => handleExportCsv(msg.columns || [], msg.rows || [])}
                                  className="p-1 bg-brand-panel hover:bg-brand-border border border-brand-border rounded-lg text-gray-400 hover:text-white transition-colors cursor-pointer"
                                  title="Export CSV"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>

                                {/* Copy Table */}
                                <button
                                  onClick={() => handleCopyTableData(idx, msg.columns || [], msg.rows || [])}
                                  className="p-1 bg-brand-panel hover:bg-brand-border border border-brand-border rounded-lg text-gray-400 hover:text-white transition-colors cursor-pointer"
                                  title="Copy Table to Clipboard"
                                >
                                  {copiedTableIndex === idx ? (
                                    <Check className="w-3.5 h-3.5 text-brand-green" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>

                            {/* View body */}
                            {isViewChart && chartConfig ? (
                              <div className="p-4 bg-brand-dark/50 h-64 flex items-center justify-center rounded-xl overflow-hidden border border-brand-border/20 transition-all duration-300">
                                <ResponsiveContainer width="100%" height="100%">
                                  {(chartTypes[idx] || 'bar') === 'line' ? (
                                    <LineChart data={chartConfig.data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#232731" vertical={false} />
                                      <XAxis dataKey="name" stroke="#9ca3af" fontSize={9} tickLine={false} />
                                      <YAxis stroke="#9ca3af" fontSize={9} tickLine={false} />
                                      <Tooltip
                                        contentStyle={{
                                          backgroundColor: '#14161d',
                                          borderColor: '#232731',
                                          borderRadius: '8px',
                                          color: '#fff',
                                          fontSize: '11px',
                                          backdropFilter: 'blur(4px)',
                                        }}
                                      />
                                      <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2.5} activeDot={{ r: 6, stroke: '#10b981', strokeWidth: 1.5, fill: '#14161d' }} />
                                    </LineChart>
                                  ) : (chartTypes[idx] || 'bar') === 'area' ? (
                                    <AreaChart data={chartConfig.data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                      <defs>
                                        <linearGradient id={`areaGradient_${idx}`} x1="0" y1="0" x2="0" y2="1">
                                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
                                        </linearGradient>
                                      </defs>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#232731" vertical={false} />
                                      <XAxis dataKey="name" stroke="#9ca3af" fontSize={9} tickLine={false} />
                                      <YAxis stroke="#9ca3af" fontSize={9} tickLine={false} />
                                      <Tooltip
                                        contentStyle={{
                                          backgroundColor: '#14161d',
                                          borderColor: '#232731',
                                          borderRadius: '8px',
                                          color: '#fff',
                                          fontSize: '11px',
                                          backdropFilter: 'blur(4px)',
                                        }}
                                      />
                                      <Area type="monotone" dataKey="value" stroke="#10b981" fill={`url(#areaGradient_${idx})`} strokeWidth={2.5} />
                                    </AreaChart>
                                  ) : (
                                    <BarChart data={chartConfig.data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                      <defs>
                                        <linearGradient id={`barGradient_${idx}`} x1="0" y1="0" x2="0" y2="1">
                                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.85}/>
                                          <stop offset="100%" stopColor="#047857" stopOpacity={0.15}/>
                                        </linearGradient>
                                      </defs>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#232731" vertical={false} />
                                      <XAxis dataKey="name" stroke="#9ca3af" fontSize={9} tickLine={false} />
                                      <YAxis stroke="#9ca3af" fontSize={9} tickLine={false} />
                                      <Tooltip
                                        contentStyle={{
                                          backgroundColor: '#14161d',
                                          borderColor: '#232731',
                                          borderRadius: '8px',
                                          color: '#fff',
                                          fontSize: '11px',
                                          backdropFilter: 'blur(4px)',
                                        }}
                                      />
                                      <Bar dataKey="value" fill={`url(#barGradient_${idx})`} radius={[4, 4, 0, 0]} activeBar={{ stroke: '#10b981', strokeWidth: 1.5, fill: '#059669' }} />
                                    </BarChart>
                                  )}
                                </ResponsiveContainer>
                              </div>
                            ) : (
                              <div className="overflow-x-auto max-h-72">
                                <table className="w-full text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="bg-brand-dark/60 border-b border-brand-border/60">
                                      {msg.columns.map((col) => (
                                        <th key={col} className="p-3 text-gray-400 font-semibold tracking-wider uppercase text-[10px]">
                                          {col}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {msg.rows.map((row, rIdx) => (
                                      <tr
                                        key={rIdx}
                                        className="border-b border-brand-border/30 hover:bg-brand-dark/40 transition-colors"
                                      >
                                        {row.map((val, cIdx) => (
                                          <td key={cIdx} className="p-3 text-gray-200 max-w-xs truncate font-mono">
                                            {val === null || val === undefined ? (
                                              <span className="text-gray-600 font-sans italic">NULL</span>
                                            ) : (
                                              String(val)
                                            )}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Agent ReAct Loop Timeline Steps */}
                        {msg.steps && msg.steps.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-brand-border/40">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-3 flex items-center justify-between">
                              <span className="flex items-center gap-1.5">
                                <Sparkles className="w-3 h-3 text-brand-green" />
                                Agent Execution Trace
                              </span>
                              {msg.geminiCallsCount !== undefined && msg.geminiCallsCount > 0 && (
                                <span className="text-[9px] text-gray-500 font-semibold tracking-normal lowercase normal-case">
                                  ({msg.geminiCallsCount} Gemini {msg.geminiCallsCount === 1 ? 'call' : 'calls'})
                                </span>
                              )}
                            </h4>
                            <div className="relative border-l border-brand-border/60 ml-2.5 pl-5 space-y-4 text-xs">
                              {msg.steps.map((step, sIdx) => {
                                const isStepSqlCollapsed = collapsedSql[`${idx}_step_${sIdx}`] !== false;
                                return (
                                  <div key={sIdx} className="relative group/step space-y-2">
                                    {/* Bullet point node */}
                                    <div className="absolute -left-[26.5px] top-1.5 w-3 h-3 rounded-full bg-brand-dark border-2 border-brand-green flex items-center justify-center shadow-md">
                                      <div className="w-1 h-1 rounded-full bg-brand-green" />
                                    </div>
                                    <div className="space-y-0.5">
                                      <div className="font-semibold text-gray-200 group-hover/step:text-brand-green transition-colors">
                                        {step.title}
                                      </div>
                                      <div className="text-gray-400 leading-normal font-mono text-[10px]">
                                        {step.description}
                                      </div>
                                    </div>

                                    {/* Embedded SQL query if present in this step */}
                                    {step.sql && (
                                      <div className="border border-brand-border/60 bg-brand-dark/40 rounded-xl overflow-hidden max-w-xl">
                                        <button
                                          type="button"
                                          onClick={() => setCollapsedSql(prev => ({ ...prev, [`${idx}_step_${sIdx}`]: !isStepSqlCollapsed }))}
                                          className="w-full px-3 py-2 bg-brand-dark/60 hover:bg-brand-dark flex items-center justify-between border-b border-brand-border/40 text-left cursor-pointer transition-colors"
                                        >
                                          <div className="flex items-center gap-2 text-gray-400">
                                            <Code className="w-3 h-3 text-brand-green" />
                                            <span className="text-[9px] font-bold uppercase tracking-wider">Executed SQL</span>
                                          </div>
                                          <span className="text-[9px] text-gray-500 font-semibold">
                                            {isStepSqlCollapsed ? 'Expand' : 'Collapse'}
                                          </span>
                                        </button>
                                        {!isStepSqlCollapsed && (
                                          <div className="p-2.5 bg-brand-dark/90 relative">
                                            <button
                                              type="button"
                                              onClick={() => handleCopySql(1000 + idx * 100 + sIdx, step.sql || '')}
                                              className="absolute top-2 right-2 p-1 bg-brand-panel hover:bg-brand-border border border-brand-border rounded-lg text-gray-400 hover:text-white transition-colors cursor-pointer"
                                            >
                                              {copiedSqlIndex === (1000 + idx * 100 + sIdx) ? (
                                                <Check className="w-3 h-3 text-brand-green" />
                                              ) : (
                                                <Copy className="w-3 h-3" />
                                              )}
                                            </button>
                                            <pre
                                              className="text-[10px] font-mono text-gray-200 overflow-x-auto whitespace-pre-wrap pr-8"
                                              dangerouslySetInnerHTML={{ __html: highlightSql(step.sql) }}
                                            />
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Embedded Table results if present in this step */}
                                    {step.columns && step.rows && step.rows.length > 0 && (
                                      <div className="border border-brand-border/60 bg-brand-dark/20 rounded-xl overflow-hidden max-w-xl">
                                        <div className="overflow-x-auto max-h-48">
                                          <table className="w-full text-left border-collapse text-[10px]">
                                            <thead>
                                              <tr className="bg-brand-dark/60 border-b border-brand-border/60">
                                                {step.columns.map((col) => (
                                                  <th key={col} className="p-2 text-gray-400 font-semibold tracking-wider uppercase text-[8px]">
                                                    {col}
                                                  </th>
                                                ))}
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {step.rows.map((row, rIdx) => (
                                                <tr key={rIdx} className="border-b border-brand-border/30 hover:bg-brand-dark/40 transition-colors">
                                                  {row.map((val, cIdx) => (
                                                    <td key={cIdx} className="p-2 text-gray-200 max-w-xs truncate font-mono">
                                                      {val === null || val === undefined ? (
                                                        <span className="text-gray-600 font-sans italic">NULL</span>
                                                      ) : (
                                                        String(val)
                                                      )}
                                                    </td>
                                                  ))}
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Suggested Followups */}
                        {msg.suggestedQuestions && msg.suggestedQuestions.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-2">
                            {msg.suggestedQuestions.map((q, qIdx) => (
                              <button
                                key={qIdx}
                                onClick={() => handleSend(q)}
                                className="px-3 py-1.5 bg-brand-dark border border-brand-border hover:border-brand-green/30 hover:bg-brand-green/5 text-gray-300 hover:text-white rounded-full text-xs font-semibold cursor-pointer transition-all"
                              >
                                {q}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* User avatar */}
                {!isAssistant && (
                  <div className="w-8 h-8 rounded-lg bg-brand-green border border-brand-green/30 flex items-center justify-center shrink-0 text-brand-dark font-bold text-xs uppercase shadow-md shadow-brand-green/10">
                    {session.username.substring(0, 2)}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* ── Real-time SSE Timeline ──────────────────────────────────────── */}
        {loading && liveSteps.length > 0 && (
          <div className="flex gap-4 justify-start">
            <div className="w-8 h-8 rounded-lg bg-brand-green/10 border border-brand-green/20 flex items-center justify-center shrink-0 text-brand-green mt-1">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
            <div className="flex-1 bg-brand-panel border border-brand-border rounded-2xl p-5 shadow-md space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-brand-border/40 pb-2">
                <span className="text-xs font-semibold text-brand-green flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-green animate-ping" />
                  {liveSteps[activeStepIndex]?.title ?? 'Processing…'}
                </span>
                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Agent Pipeline</span>
              </div>

              {/* Horizontal delivery-style timeline */}
              <div className="w-full py-2 overflow-x-auto">
                <div className="flex items-center min-w-max px-2 gap-0">
                  {liveSteps.map((step, sIdx) => {
                    const isActive = sIdx === activeStepIndex;
                    const isCompleted = sIdx < activeStepIndex;
                    const isError = step.status === 'error';

                    return (
                      <div key={sIdx} className="flex items-center">
                        {/* Step node */}
                        <div className="flex flex-col items-center" style={{ minWidth: '80px' }}>
                          {/* Circle */}
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 z-10 transition-all duration-500 text-[10px] font-bold ${
                            isError
                              ? 'bg-red-900/40 border-red-500 text-red-400'
                              : isCompleted
                                ? 'bg-brand-green border-brand-green text-brand-dark shadow-md shadow-brand-green/20'
                                : isActive
                                  ? 'bg-brand-dark border-brand-green text-brand-green animate-pulse'
                                  : 'bg-brand-panel border-brand-border text-gray-500'
                          }`}>
                            {isError ? '✕' : isCompleted ? '✓' : sIdx + 1}
                          </div>
                          {/* Label */}
                          <span className={`text-[9px] font-bold uppercase tracking-wide mt-2 text-center leading-tight max-w-[72px] ${
                            isError ? 'text-red-400' : (isCompleted || isActive) ? 'text-white' : 'text-gray-600'
                          }`}>
                            {step.title}
                          </span>
                          {/* Description tooltip on active */}
                          {isActive && step.description && (
                            <span className="text-[9px] text-gray-400 text-center max-w-[90px] mt-1 leading-tight italic">
                              {step.description.length > 40 ? step.description.slice(0, 37) + '…' : step.description}
                            </span>
                          )}
                        </div>

                        {/* Connector line */}
                        {sIdx < liveSteps.length - 1 && (
                          <div className={`h-[2px] flex-1 mx-1 transition-colors duration-500 ${
                            sIdx < activeStepIndex ? 'bg-brand-green shadow-[0_0_6px_rgba(16,185,129,0.4)]' : 'bg-brand-border'
                          }`} style={{ minWidth: '24px', maxWidth: '48px' }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form area */}
      <div className="p-4 border-t border-brand-border bg-brand-panel relative z-10">
        {isUrlMismatch && (
          <div className="max-w-3xl mx-auto mb-3 p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <div className="flex-1">
              This conversation belongs to database <span className="font-mono text-white break-all">{activeConversation.jdbc_url}</span>, but the app is currently connected to <span className="font-mono text-white break-all">{connectionInfo?.base_url || 'none'}</span>. Please connect to the correct database to continue this conversation.
            </div>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isUrlMismatch) return;
            handleSend(input);
          }}
          className="relative max-w-3xl mx-auto flex items-center"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (isUrlMismatch) return;
                handleSend(input);
              }
            }}
            rows={1}
            disabled={loading || !!isUrlMismatch}
            className="w-full pl-4 pr-12 py-3.5 bg-brand-dark/80 border border-brand-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/20 transition-all text-sm resize-none disabled:opacity-40"
          />

          <button
            type="submit"
            disabled={loading || !input.trim() || !!isUrlMismatch}
            className="absolute right-3.5 p-2 bg-brand-green hover:bg-brand-green-hover text-brand-dark disabled:opacity-30 disabled:hover:bg-brand-green rounded-lg transition-colors cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>

        <div className="mt-2 text-center text-[10px] text-gray-500 font-semibold tracking-wider flex items-center justify-center gap-1.5 uppercase">
          <Database className="w-3 h-3 text-brand-green/80" />
          Scope: {selectedDatabases.length > 0 ? `${selectedDatabases.join(', ').toUpperCase()}` : 'ALL DATABASES'}
        </div>
      </div>
    </div>
  );
};
export default ChatWindow;
