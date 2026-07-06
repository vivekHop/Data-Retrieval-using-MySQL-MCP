export interface ColumnSchema {
  name: string;
  type: string;
  is_primary: boolean;
  is_foreign: boolean;
  referenced_table: string | null;
  referenced_column: string | null;
}

export interface TableSchema {
  columns: ColumnSchema[];
  primary_keys: string[];
  foreign_keys: {
    column: string;
    ref_table: string;
    ref_column: string;
  }[];
}

export interface DatabaseSchema {
  [tableName: string]: TableSchema;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sql?: string | null;
  columns?: string[] | null;
  rows?: any[][] | null;
  executionTimeMs?: number;
  rowCount?: number;
  database?: string | null;
  error?: string | null;
  timestamp: string;
  suggestedQuestions?: string[];
  geminiCallsCount?: number;
  steps?: {
    title: string;
    description: string;
    status: string;
    sql?: string;
    columns?: string[];
    rows?: any[][];
    execution_time_ms?: number;
    row_count?: number;
    error?: string;
    database?: string;
  }[] | null;
}

export interface Conversation {
  id: string;
  title: string;
  timestamp: string;
  jdbc_url?: string | null;
}

export interface AuditLog {
  id: number;
  user_id: string;
  timestamp: string;
  question: string;
  generated_sql: string | null;
  database_used: string | null;
  execution_time_ms: number;
  status: string;
  error_message: string | null;
}

export interface UserSession {
  username: string;
  role: string;
  token: string;
  fullName: string;
}
