import type { UserSession, DatabaseSchema, AuditLog } from './types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// Token storage key
const TOKEN_KEY = 'mcp_sql_assistant_session';
// Stable per-browser-tab identity for backend session isolation
const CLIENT_ID_KEY = 'mcp_client_id';

function getOrCreateClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `client_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export const api = {
  // Retrieve token from local storage
  getSession(): UserSession | null {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  // Set session
  setSession(session: UserSession | null) {
    if (session) {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  },

  // Headers helper — always includes X-Client-Id for backend session isolation
  getHeaders() {
    const session = this.getSession();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-Id': getOrCreateClientId(),
    };
    if (session?.token) {
      headers['Authorization'] = `Bearer ${session.token}`;
    }
    return headers;
  },

  // Auth: Login
  async login(username: string, password: string): Promise<UserSession> {
    // Standard OAuth2 form urlencode
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);

    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Login failed. Invalid username or password.');
    }

    const data = await response.json();
    
    // Fetch user details to get full name
    const meResponse = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: {
        'Authorization': `Bearer ${data.access_token}`,
      },
    });
    
    const meData = await meResponse.json();

    const session: UserSession = {
      username: data.username,
      role: data.role,
      token: data.access_token,
      fullName: meData.full_name || data.username,
    };

    this.setSession(session);
    return session;
  },

  // Metadata: Get databases
  async getDatabases(): Promise<string[]> {
    const response = await fetch(`${API_BASE_URL}/metadata/databases`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch databases');
    return response.json();
  },

  // Metadata: Get schema for database
  async getSchema(database: string): Promise<DatabaseSchema> {
    const response = await fetch(`${API_BASE_URL}/metadata/schema/${database}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error(`Failed to fetch schema for ${database}`);
    return response.json();
  },

  // Metadata: Refresh cache (soft — only this client)
  async refreshMetadata(): Promise<{ status: string; databases: string[] }> {
    const response = await fetch(`${API_BASE_URL}/metadata/refresh`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to refresh metadata');
    }
    return response.json();
  },

  // Metadata: Hard refresh — purges shared cache, forces full re-crawl for all clients
  async hardRefreshMetadata(): Promise<{ status: string; message: string; databases: string[] }> {
    const response = await fetch(`${API_BASE_URL}/metadata/hard-refresh`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Hard refresh failed');
    }
    return response.json();
  },

  // Connect via JDBC URL
  async connectJdbc(jdbcUrl: string, username?: string, password?: string): Promise<{ status: string; message: string; databases: string[]; connection_info: any }> {
    const response = await fetch(`${API_BASE_URL}/metadata/connect`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ 
        jdbc_url: jdbcUrl,
        username: username || null,
        password: password || null
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to connect to the database.');
    }
    return response.json();
  },

  // Query: Ask natural language query (streaming SSE)
  async askQuestionStream(
    prompt: string,
    selectedDatabases: string[] | undefined,
    conversationId: string | undefined,
    onStep: (step: any) => void,
    onResult: (result: any) => void,
    onError: (message: string) => void,
  ): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/query/ask/stream`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        prompt,
        selected_databases: selectedDatabases || null,
        conversation_id: conversationId || null,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Server error while processing your request.');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body from server.');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by double newlines
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? ''; // keep incomplete last chunk

      for (const part of parts) {
        if (!part.trim()) continue;
        let eventType = 'message';
        let dataLine = '';

        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          else if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
        }

        if (!dataLine) continue;

        try {
          const data = JSON.parse(dataLine);
          if (eventType === 'step') onStep(data);
          else if (eventType === 'result') onResult(data);
          else if (eventType === 'error') onError(data.message || 'Unknown error');
        } catch {
          // malformed JSON — ignore
        }
      }
    }
  },

  // Query: Ask natural language query (non-streaming fallback)
  async askQuestion(prompt: string, selectedDatabases?: string[], conversationId?: string) {
    const response = await fetch(`${API_BASE_URL}/query/ask`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        prompt,
        selected_databases: selectedDatabases || null,
        conversation_id: conversationId || null,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Server encountered an error while processing your request.');
    }

    return response.json();
  },

  // Admin: Get audit logs
  async getAuditLogs(limit = 100): Promise<AuditLog[]> {
    const response = await fetch(`${API_BASE_URL}/admin/logs?limit=${limit}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Access denied. Administrator privileges required.');
    }
    return response.json();
  },

  // Metadata: Get active connection status
  async getConnectionInfo(): Promise<{ connected: boolean; base_url: string | null; engine_type: string | null; database: string }> {
    const response = await fetch(`${API_BASE_URL}/metadata/connection-info`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch active connection details');
    return response.json();
  },

  // Metadata: Get UAT default credentials
  async getUatInfo(): Promise<{ jdbc_url: string; username: string; password: string }> {
    const response = await fetch(`${API_BASE_URL}/metadata/uat-info`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch UAT connection details');
    return response.json();
  },

  // Chats: Get conversations list
  async getConversations(jdbcUrl?: string) {
    const url = jdbcUrl 
      ? `${API_BASE_URL}/chats/conversations?jdbc_url=${encodeURIComponent(jdbcUrl)}`
      : `${API_BASE_URL}/chats/conversations`;
    const response = await fetch(url, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch conversations');
    return response.json();
  },

  // Chats: Create a new conversation
  async createConversation(id: string, title: string, jdbcUrl?: string) {
    const response = await fetch(`${API_BASE_URL}/chats/conversations`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ id, title, jdbc_url: jdbcUrl || null }),
    });
    if (!response.ok) throw new Error('Failed to create conversation');
    return response.json();
  },

  // Chats: Rename/update conversation
  async updateConversation(id: string, title: string) {
    const response = await fetch(`${API_BASE_URL}/chats/conversations/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!response.ok) throw new Error('Failed to update conversation');
    return response.json();
  },

  // Chats: Delete conversation
  async deleteConversation(id: string) {
    const response = await fetch(`${API_BASE_URL}/chats/conversations/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete conversation');
    return response.json();
  },

  // Chats: Get conversation messages
  async getConversationMessages(id: string) {
    const response = await fetch(`${API_BASE_URL}/chats/conversations/${id}/messages`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch conversation messages');
    return response.json();
  },

  // Chats: Delete a specific message
  async deleteMessage(messageId: string) {
    const response = await fetch(`${API_BASE_URL}/chats/messages/${messageId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete message');
    return response.json();
  },
};
export default api;
