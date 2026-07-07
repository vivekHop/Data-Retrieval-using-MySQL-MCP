import React, { useState, useEffect, useCallback } from 'react';
import type { Message, Conversation, UserSession } from './types';
import { Sidebar } from './components/Sidebar';
import { ChatWindow } from './components/ChatWindow';
import { QueryHistory } from './components/QueryHistory';
import { api } from './api';
import { Database, Lock, Loader2, AlertCircle } from 'lucide-react';

type ConnectionInfo = {
  connected: boolean;
  base_url: string | null;
  engine_type: string | null;
  database: string;
};

export const App: React.FC = () => {
  const [session] = useState<UserSession | null>({
    username: 'admin',
    role: 'admin',
    token: 'bypass',
    fullName: 'System Administrator',
  });

  // ── UI state ─────────────────────────────────────────────────────────────
  const [selectedDatabases, setSelectedDatabases] = useState<string[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [switchingConversationId, setSwitchingConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAuditLogsOpen, setIsAuditLogsOpen] = useState(false);

  // ── Connection / modal state ──────────────────────────────────────────────
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  // Always show the modal on page load so users explicitly choose their DB source
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(true);
  const [uatInfo, setUatInfo] = useState<{ jdbc_url: string; username: string; password: string } | null>(null);
  const [modalTab, setModalTab] = useState<'uat' | 'custom'>('uat');
  const [customJdbcUrl, setCustomJdbcUrl] = useState('');
  const [customUsername, setCustomUsername] = useState('');
  const [customPassword, setCustomPassword] = useState('');
  const [modalConnecting, setModalConnecting] = useState(false);
  const [modalError, setModalError] = useState('');

  // ── Load UAT defaults on mount (no auto-connect) ─────────────────────────
  useEffect(() => {
    api.getUatInfo()
      .then(uat => setUatInfo(uat))
      .catch(err => console.error('Failed to load UAT credentials:', err));
  }, []);

  // ── Conversations (filtered by active JDBC base URL) ──────────────────────
  const loadConversations = useCallback(async (jdbcBaseUrl?: string | null) => {
    const url = jdbcBaseUrl ?? connectionInfo?.base_url ?? undefined;
    try {
      const list: Conversation[] = await api.getConversations(url ?? undefined);
      setConversations(list);
      if (list.length > 0) {
        const firstId = list[0].id;
        await loadMessagesForConversation(firstId);
      } else {
        await createNewConversation(url);
      }
    } catch {
      await createNewConversation(url);
    }
  }, [connectionInfo?.base_url]);

  // ── Messages ──────────────────────────────────────────────────────────────
  // Load messages first, THEN flip the active conversation ID — this ensures
  // the sidebar only highlights the new chat once its content is ready.
  const loadMessagesForConversation = async (id: string) => {
    setSwitchingConversationId(id);
    setMessagesLoading(true);
    try {
      const msgs = await api.getConversationMessages(id);
      setMessages(msgs);
      setActiveConversationId(id);
    } catch {
      setMessages([]);
      setActiveConversationId(id);
    } finally {
      setMessagesLoading(false);
      setSwitchingConversationId(null);
    }
  };

  const handleSelectConversation = (id: string) => {
    if (id === activeConversationId) return;
    loadMessagesForConversation(id);
  };

  // ── Conversation CRUD ─────────────────────────────────────────────────────
  const createNewConversation = async (jdbcUrl?: string | null) => {
    if (!session) return;
    const newId = `chat_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
    const newChat: Conversation = {
      id: newId,
      title: 'New Conversation',
      timestamp: new Date().toISOString(),
      jdbc_url: jdbcUrl ?? null,
    };
    try {
      await api.createConversation(newId, 'New Conversation', jdbcUrl ?? undefined);
      setConversations(prev => [newChat, ...prev]);
      setActiveConversationId(newId);
      setMessages([]);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const handleCreateConversation = () => createNewConversation(connectionInfo?.base_url);

  const handleDeleteConversation = async (id: string) => {
    if (!session) return;
    try {
      await api.deleteConversation(id);
      const updated = conversations.filter(c => c.id !== id);
      setConversations(updated);
      if (activeConversationId === id) {
        if (updated.length > 0) {
          setActiveConversationId(updated[0].id);
        } else {
          await handleCreateConversation();
        }
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const handleRenameConversation = async (id: string, newTitle: string) => {
    try {
      await api.updateConversation(id, newTitle);
      setConversations(prev => prev.map(c => c.id === id ? { ...c, title: newTitle } : c));
    } catch (err) {
      console.error('Failed to rename conversation:', err);
    }
  };

  const handleReloadConversations = async () => {
    const url = connectionInfo?.base_url ?? undefined;
    try {
      const list: Conversation[] = await api.getConversations(url ?? undefined);
      setConversations(list);
      if (activeConversationId && list.some(c => c.id === activeConversationId)) {
        // Keep active
      } else if (list.length > 0) {
        await loadMessagesForConversation(list[0].id);
      }
    } catch (err) {
      console.error('Failed to reload conversations:', err);
    }
  };

  const handleReloadMessages = async () => {
    if (!activeConversationId) return;
    setMessagesLoading(true);
    try {
      const msgs = await api.getConversationMessages(activeConversationId);
      setMessages(msgs);
    } catch (err) {
      console.error('Failed to reload messages:', err);
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await api.deleteMessage(messageId);
      setMessages(prev => prev.filter(m => m.id !== messageId));
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
  };

  const handleAddMessage = (msg: Message) => {
    if (!activeConversationId) return;
    setMessages(prev => [...prev, msg]);
    if (msg.role === 'user' && messages.length === 0) {
      const title = msg.text.length > 30 ? `${msg.text.substring(0, 30)}…` : msg.text;
      setConversations(prev =>
        prev.map(c => c.id === activeConversationId ? { ...c, title } : c)
      );
      api.updateConversation(activeConversationId, title).catch(console.error);
    }
  };

  // ── Connection success handler ─────────────────────────────────────────────
  const handleConnectSuccess = async (info: ConnectionInfo) => {
    // Switching JDBC ⟹ clear all previous schema / conversation state for this client
    setConnectionInfo(info);
    setSelectedDatabases([]);
    setMessages([]);
    setConversations([]);
    setActiveConversationId(null);
    await loadConversations(info.base_url);
  };

  // ── Startup modal submit ──────────────────────────────────────────────────
  const handleModalConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalConnecting(true);
    setModalError('');

    let url = '';
    let user = '';
    let pass = '';

    if (modalTab === 'uat') {
      if (!uatInfo) {
        setModalError('UAT credentials not loaded yet. Please wait…');
        setModalConnecting(false);
        return;
      }
      url = uatInfo.jdbc_url;
      user = uatInfo.username;
      pass = uatInfo.password;
    } else {
      if (!customJdbcUrl.trim()) {
        setModalError('JDBC URL is required.');
        setModalConnecting(false);
        return;
      }
      url = customJdbcUrl.trim();
      user = customUsername.trim();
      pass = customPassword.trim();
    }

    try {
      const res = await api.connectJdbc(url, user, pass);
      await handleConnectSuccess(res.connection_info as ConnectionInfo);
      setIsConnectModalOpen(false);
    } catch (err: any) {
      setModalError(err.message || 'Connection failed. Check your JDBC URL and credentials.');
    } finally {
      setModalConnecting(false);
    }
  };

  if (!session) return null;

  return (
    <div className="flex h-screen bg-brand-dark overflow-hidden font-sans">

      {/* Sidebar */}
      <Sidebar
        session={session}
        conversations={conversations}
        activeConversationId={activeConversationId}
        switchingConversationId={switchingConversationId}
        onSelectConversation={handleSelectConversation}
        onCreateConversation={handleCreateConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        onReloadConversations={handleReloadConversations}
        onOpenAuditLogs={() => setIsAuditLogsOpen(true)}
        selectedDatabases={selectedDatabases}
        onSelectDatabases={setSelectedDatabases}
        connectionInfo={connectionInfo}
        onConnectSuccess={handleConnectSuccess}
        onOpenConnectionModal={() => { setModalError(''); setIsConnectModalOpen(true); }}
      />

      {/* Chat */}
      <ChatWindow
        session={session}
        activeConversationId={activeConversationId}
        selectedDatabases={selectedDatabases}
        messages={messages}
        onAddMessage={handleAddMessage}
        loading={loading}
        setLoading={setLoading}
        conversations={conversations}
        connectionInfo={connectionInfo}
        messagesLoading={messagesLoading}
        onReloadMessages={handleReloadMessages}
        onDeleteMessage={handleDeleteMessage}
      />

      {/* Audit logs drawer */}
      <QueryHistory
        session={session}
        isOpen={isAuditLogsOpen}
        onClose={() => setIsAuditLogsOpen(false)}
      />

      {/* ── Startup / Switch-DB Connection Modal ─────────────────────────── */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-dark/95 backdrop-blur-md p-4">
          <div className="bg-brand-panel border border-brand-border/60 w-[560px] max-w-full rounded-2xl shadow-2xl animate-slide-in relative overflow-hidden">

            {/* Top accent */}
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-brand-green via-emerald-400 to-brand-green" />

            <div className="p-6 space-y-5">
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-green/10 border border-brand-green/30 flex items-center justify-center text-brand-green shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white leading-tight">Database Connection</h2>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Choose your SQL source — all databases on that server are loaded automatically.
                  </p>
                </div>
                {/* Re-connect button if already connected */}
                {connectionInfo?.connected && (
                  <button
                    type="button"
                    onClick={() => setIsConnectModalOpen(false)}
                    className="ml-auto p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-brand-border/40 transition-all cursor-pointer text-xs font-bold"
                  >
                    ✕ Cancel
                  </button>
                )}
              </div>

              {/* Tab selector */}
              <div className="flex gap-1 bg-brand-dark/50 p-1 rounded-xl border border-brand-border/40">
                {(['uat', 'custom'] as const).map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => { setModalTab(tab); setModalError(''); }}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                      modalTab === tab
                        ? 'bg-brand-panel text-white shadow border border-brand-border/50'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {tab === 'uat' ? '⚡ Connect UAT (Default)' : '🔧 Custom JDBC Source'}
                  </button>
                ))}
              </div>

              <form onSubmit={handleModalConnect} className="space-y-4">
                {/* UAT tab */}
                {modalTab === 'uat' ? (
                  <div className="bg-brand-dark/30 border border-brand-border/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <Lock className="w-4 h-4 text-brand-green shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-semibold text-gray-200">UAT Environment Defaults</div>
                        <div className="text-[11px] text-gray-500 leading-relaxed mt-0.5">
                          Pre-configured AWS RDS credentials. All databases on that server are loaded automatically.
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-brand-border/30 pt-3 space-y-2">
                      <div>
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">JDBC URL</span>
                        <div className="text-[11px] text-brand-green font-mono break-all mt-0.5 leading-tight">
                          {uatInfo?.jdbc_url || <span className="text-gray-500 italic">Loading…</span>}
                        </div>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Username</span>
                        <div className="text-[11px] text-gray-300 font-mono mt-0.5">
                          {uatInfo?.username || <span className="text-gray-500 italic">Loading…</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Custom tab */
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                        JDBC Connection URL <span className="text-red-400">*</span>
                      </label>
                      <textarea
                        value={customJdbcUrl}
                        onChange={e => setCustomJdbcUrl(e.target.value)}
                        placeholder="jdbc:mysql://host:3306/db?autoReconnect=true&useSSL=false"
                        rows={2}
                        disabled={modalConnecting}
                        className="w-full p-3 bg-brand-dark border border-brand-border rounded-xl text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand-green resize-none font-mono"
                      />
                      <p className="text-[10px] text-gray-500 mt-1">
                        No need to specify database — all databases on the server will be loaded.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Username</label>
                        <input
                          type="text"
                          value={customUsername}
                          onChange={e => setCustomUsername(e.target.value)}
                          placeholder="root"
                          disabled={modalConnecting}
                          className="w-full px-3 py-2 bg-brand-dark border border-brand-border rounded-xl text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand-green"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Password</label>
                        <input
                          type="password"
                          value={customPassword}
                          onChange={e => setCustomPassword(e.target.value)}
                          placeholder="••••••••"
                          disabled={modalConnecting}
                          className="w-full px-3 py-2 bg-brand-dark border border-brand-border rounded-xl text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand-green"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Error */}
                {modalError && (
                  <div className="p-3 bg-red-950/30 border border-red-500/30 rounded-xl flex items-start gap-2 text-xs text-red-300">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{modalError}</span>
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={modalConnecting || (modalTab === 'uat' && !uatInfo)}
                  className="w-full py-3 bg-brand-green hover:bg-brand-green-hover disabled:opacity-40 text-brand-dark font-bold text-sm rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-brand-green/10"
                >
                  {modalConnecting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Connecting…</>
                  ) : (
                    <><Database className="w-4 h-4" />Establish Connection</>
                  )}
                </button>

                {/* Already connected hint */}
                {connectionInfo?.connected && (
                  <p className="text-center text-[10px] text-gray-500">
                    Currently connected to <span className="text-brand-green font-mono">{connectionInfo.base_url}</span>
                    {' '}— connecting to a new source will clear your active session.
                  </p>
                )}
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
