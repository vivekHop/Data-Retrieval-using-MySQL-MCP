import React, { useState } from 'react';
import { api } from '../api';
import type { UserSession } from '../types';
import { Shield, Key, Database, User, Terminal, Loader2 } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (session: UserSession) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const session = await api.login(username, password);
      onLoginSuccess(session);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoFill = (user: string, pass: string) => {
    setUsername(user);
    setPassword(pass);
  };

  return (
    <div className="min-height-100svh flex items-center justify-center p-4 bg-brand-dark relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-brand-green/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />

      <div className="w-full max-w-md animate-slide-in relative z-10">
        {/* Logo and header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-brand-green/10 rounded-2xl border border-brand-green/20 mb-4 glow-green">
            <Database className="w-8 h-8 text-brand-green" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white m-0">
            Enterprise SQL Assistant
          </h1>
          <p className="text-gray-400 text-sm mt-2">
            Model Context Protocol powered Database Agent
          </p>
        </div>

        {/* Login form */}
        <div className="glass-panel rounded-2xl p-8 shadow-2xl relative border-brand-border">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Username
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-gray-500">
                  <User className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin"
                  disabled={loading}
                  className="w-full pl-10 pr-4 py-3 bg-brand-dark/50 border border-brand-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/20 transition-all text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-gray-500">
                  <Key className="w-4 h-4" />
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  className="w-full pl-10 pr-4 py-3 bg-brand-dark/50 border border-brand-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green/20 transition-all text-sm"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-brand-green text-brand-dark font-semibold rounded-xl hover:bg-brand-green-hover transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-brand-green/10"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Authenticating...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Quick Demo Access */}
          <div className="mt-8 pt-6 border-t border-brand-border">
            <span className="block text-center text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
              Demo Access Accounts
            </span>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => handleDemoFill('admin', 'admin123')}
                disabled={loading}
                className="py-2.5 px-2 bg-brand-dark/40 border border-brand-border hover:border-brand-green/30 hover:bg-brand-green/5 text-gray-300 rounded-lg text-xs font-medium cursor-pointer transition-all flex flex-col items-center gap-1.5"
              >
                <Shield className="w-3.5 h-3.5 text-red-400" />
                <span>Admin</span>
              </button>
              <button
                type="button"
                onClick={() => handleDemoFill('dev', 'dev123')}
                disabled={loading}
                className="py-2.5 px-2 bg-brand-dark/40 border border-brand-border hover:border-brand-green/30 hover:bg-brand-green/5 text-gray-300 rounded-lg text-xs font-medium cursor-pointer transition-all flex flex-col items-center gap-1.5"
              >
                <Terminal className="w-3.5 h-3.5 text-brand-green" />
                <span>Developer</span>
              </button>
              <button
                type="button"
                onClick={() => handleDemoFill('user', 'user123')}
                disabled={loading}
                className="py-2.5 px-2 bg-brand-dark/40 border border-brand-border hover:border-brand-green/30 hover:bg-brand-green/5 text-gray-300 rounded-lg text-xs font-medium cursor-pointer transition-all flex flex-col items-center gap-1.5"
              >
                <User className="w-3.5 h-3.5 text-blue-400" />
                <span>Analyst</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
