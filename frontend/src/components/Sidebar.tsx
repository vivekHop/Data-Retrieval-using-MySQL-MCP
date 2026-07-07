import React, { useState } from 'react';
import type { Conversation, UserSession } from '../types';
import { SchemaViewer } from './SchemaViewer';
import { MessageSquare, Plus, Search, Database, ShieldAlert, Trash2, Edit2, Check, X, RefreshCw, Loader2 } from 'lucide-react';

interface SidebarProps {
  session: UserSession;
  conversations: Conversation[];
  activeConversationId: string | null;
  switchingConversationId?: string | null;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onReloadConversations?: () => void;
  onOpenAuditLogs: () => void;
  selectedDatabases: string[];
  onSelectDatabases: (dbs: string[]) => void;
  connectionInfo: { connected: boolean; base_url: string | null; engine_type: string | null; database: string } | null;
  onConnectSuccess: (info: any) => void;
  onOpenConnectionModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  session,
  conversations,
  activeConversationId,
  switchingConversationId = null,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  onReloadConversations,
  onOpenAuditLogs,
  selectedDatabases,
  onSelectDatabases,
  connectionInfo,
  onConnectSuccess,
  onOpenConnectionModal,
}) => {
  const [activeTab, setActiveTab] = useState<'chats' | 'schema'>('chats');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const isAdmin = session.role === 'admin';

  const handleStartRename = (e: React.MouseEvent, id: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingChatId(id);
    setEditTitle(currentTitle);
  };

  const handleSaveRename = (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
    e.stopPropagation();
    if (editTitle.trim()) {
      onRenameConversation(id, editTitle.trim());
    }
    setEditingChatId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(null);
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-72 h-full bg-brand-panel border-r border-brand-border flex flex-col shrink-0">
      {/* App Branding & Profile header */}
      <div className="p-4 border-b border-brand-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <span className="font-bold text-sm text-white uppercase tracking-wider">Enterprise AI SQL Assistant</span>
          </div>
          <button
            onClick={onOpenConnectionModal}
            title="Switch / change database connection"
            className="p-1.5 rounded-lg text-gray-500 hover:text-brand-green hover:bg-brand-dark/40 border border-transparent hover:border-brand-border/40 transition-all cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Active connection badge */}
        {connectionInfo?.connected && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-brand-dark/40 border border-brand-green/20 rounded-lg">
            <div className="w-1.5 h-1.5 rounded-full bg-brand-green animate-pulse" />
            <span className="text-[10px] text-brand-green font-mono truncate" title={connectionInfo.base_url || ''}>
              {connectionInfo.engine_type?.toUpperCase()} · {connectionInfo.base_url}
            </span>
          </div>
        )}
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-brand-border bg-brand-dark/30 p-1">
        <button
          onClick={() => setActiveTab('chats')}
          className={`flex-1 py-2 text-center text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'chats'
              ? 'bg-brand-dark text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Conversations
        </button>
        <button
          onClick={() => setActiveTab('schema')}
          className={`flex-1 py-2 text-center text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
            activeTab === 'schema'
              ? 'bg-brand-dark text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          Schema Explorer
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === 'schema' ? (
          <SchemaViewer
            selectedDatabases={selectedDatabases}
            onSelectDatabases={onSelectDatabases}
            connectionInfo={connectionInfo}
            onConnectSuccess={onConnectSuccess}
            onOpenConnectionModal={onOpenConnectionModal}
          />
        ) : (
          <div className="flex flex-col h-full">
            {/* New chat action */}
            <div className="p-3 flex gap-2">
              <button
                onClick={onCreateConversation}
                className="flex-1 py-2 bg-brand-green hover:bg-brand-green-hover text-brand-dark font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-md shadow-brand-green/5"
              >
                <Plus className="w-3.5 h-3.5" />
                New Chat
              </button>
              {onReloadConversations && (
                <button
                  type="button"
                  onClick={onReloadConversations}
                  className="px-3 py-2 bg-brand-dark hover:bg-brand-border border border-brand-border text-gray-400 hover:text-white rounded-xl transition-all cursor-pointer flex items-center justify-center"
                  title="Reload Chats List"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Chat search */}
            <div className="px-3 pb-2 border-b border-brand-border">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-brand-dark/50 border border-brand-border rounded-lg text-gray-300 placeholder-gray-500 text-xs focus:outline-none focus:border-brand-green transition-all"
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredConversations.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-xs">No conversations yet</div>
              ) : (
                filteredConversations.map((chat) => {
                  const isEditing = editingChatId === chat.id;
                  return (
                    <div
                      key={chat.id}
                      className={`group/item flex items-center justify-between p-2.5 rounded-xl cursor-pointer border border-transparent transition-all ${
                        activeConversationId === chat.id
                          ? 'bg-brand-dark/70 border-brand-border/60 text-white'
                          : 'text-gray-400 hover:bg-brand-dark/30 hover:text-white'
                      }`}
                      onClick={() => !isEditing && onSelectConversation(chat.id)}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 w-full mr-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(e, chat.id);
                              if (e.key === 'Escape') setEditingChatId(null);
                            }}
                            autoFocus
                            className="flex-1 px-2 py-1 bg-brand-dark border border-brand-green rounded text-xs text-white focus:outline-none"
                          />
                          <button
                            onClick={(e) => handleSaveRename(e, chat.id)}
                            className="p-1 text-brand-green hover:bg-brand-dark rounded transition-colors"
                            title="Save Title"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={handleCancelRename}
                            className="p-1 text-red-400 hover:bg-brand-dark rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 min-w-0">
                            {switchingConversationId === chat.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-green shrink-0" />
                            ) : (
                              <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${
                                activeConversationId === chat.id ? 'text-brand-green' : 'text-gray-500'
                              }`} />
                            )}
                            <span className="text-xs font-medium truncate">{chat.title}</span>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => handleStartRename(e, chat.id, chat.title)}
                              className="opacity-0 group-hover/item:opacity-100 p-1 text-gray-500 hover:text-brand-green hover:bg-brand-dark rounded-md transition-all cursor-pointer"
                              title="Rename Conversation"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteConversation(chat.id);
                              }}
                              className="opacity-0 group-hover/item:opacity-100 p-1 text-gray-500 hover:text-red-400 hover:bg-brand-dark rounded-md transition-all cursor-pointer"
                              title="Delete Conversation"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Admin Panel Actions */}
      {isAdmin && (
        <div className="p-3 border-t border-brand-border bg-brand-dark/20">
          <button
            onClick={onOpenAuditLogs}
            className="w-full py-2 bg-brand-dark hover:bg-brand-border border border-brand-border rounded-xl text-xs font-semibold text-gray-300 hover:text-white transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-black/10"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-brand-green" />
            System Audit Trail
          </button>
        </div>
      )}
    </div>
  );
};
export default Sidebar;
