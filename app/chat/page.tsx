'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  MessageSquare,
  Plus,
  Trash2,
  Send,
  Square,
  Bot,
  User,
  Sparkles,
  KeyRound,
  Loader2,
  LogOut,
  ArrowLeft,
  Zap,
  Globe,
  RefreshCw,
  Clock,
  Check,
  Copy
} from 'lucide-react';

interface ResultData {
  api_key: string;
  base_url: string;
  plan: string;
  plan_days: number;
  category: 'deepseek' | 'gpt' | 'claude' | null;
  category_label: string | null;
  has_codex: boolean;
  rph: number;
  activated_at: number;
  expires_at: number | null;
  models: string[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  selectedModel: string;
  createdAt: number;
}

export default function ChatPage() {
  const router = useRouter();

  // 认证状态
  const [data, setData] = useState<ResultData | null>(null);
  const [inputKey, setInputKey] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // 会话状态
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  
  // 输入与流式传输状态
  const [input, setInput] = useState('');
  const [isGenerating, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // 复制反馈
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // 1. 初始化，加载认证信息
  useEffect(() => {
    const raw = localStorage.getItem('nc_cache');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ResultData;
        if (parsed.api_key && (!parsed.expires_at || parsed.expires_at * 1000 > Date.now())) {
          setData(parsed);
          if (parsed.models && parsed.models.length > 0) {
            setSelectedModel(parsed.models[0]);
          }
        }
      } catch {
        localStorage.removeItem('nc_cache');
      }
    }
  }, []);

  // 2. 加载该 Key 对应的聊天历史
  useEffect(() => {
    if (!data?.api_key) return;
    const historyKey = `nc_chat_history_${data.api_key}`;
    const rawHistory = localStorage.getItem(historyKey);
    if (rawHistory) {
      try {
        const parsed = JSON.parse(rawHistory) as ChatSession[];
        setSessions(parsed);
        if (parsed.length > 0) {
          setActiveSessionId(parsed[0].id);
          setSelectedModel(parsed[0].selectedModel || data.models[0]);
        } else {
          // 如果没有会话，自动创建一个
          createNewSession(data.models[0]);
        }
      } catch {
        localStorage.removeItem(historyKey);
        createNewSession(data.models[0]);
      }
    } else {
      createNewSession(data.models[0]);
    }
  }, [data?.api_key]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSessionId, sessions, isGenerating]);

  // 3. 直接输入 Key 登录
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!inputKey.trim().startsWith('sk-')) {
      setAuthError('请输入正确的 API Key (以 sk- 开头)');
      return;
    }
    setAuthError(null);
    setAuthLoading(true);

    try {
      const res = await fetch('/api/card-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sk: inputKey.trim() }),
      });
      const body = await res.json();
      if (!body.success) {
        setAuthError(body.message || '登录失败，请确认 API Key 是否有效');
        setAuthLoading(false);
        return;
      }

      setData(body.data);
      localStorage.setItem('nc_cache', JSON.stringify(body.data));
      if (body.data.models && body.data.models.length > 0) {
        setSelectedModel(body.data.models[0]);
      }
      setAuthLoading(false);
    } catch (err) {
      setAuthError('网络错误，请稍后重试');
      setAuthLoading(false);
    }
  }

  // 4. 创建新会话
  function createNewSession(defaultModel: string) {
    if (!data) return;
    const newSession: ChatSession = {
      id: Math.random().toString(36).slice(2, 11),
      title: '新的对话',
      messages: [],
      selectedModel: defaultModel || selectedModel || data.models[0],
      createdAt: Date.now()
    };
    const updated = [newSession, ...sessions];
    setSessions(updated);
    setActiveSessionId(newSession.id);
    if (newSession.selectedModel) {
      setSelectedModel(newSession.selectedModel);
    }
    saveHistory(updated);
  }

  // 保存历史到 localStorage
  function saveHistory(updatedSessions: ChatSession[]) {
    if (!data?.api_key) return;
    localStorage.setItem(`nc_chat_history_${data.api_key}`, JSON.stringify(updatedSessions));
  }

  // 删除会话
  function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    saveHistory(updated);

    if (activeSessionId === id) {
      if (updated.length > 0) {
        setActiveSessionId(updated[0].id);
        setSelectedModel(updated[0].selectedModel || data?.models[0] || '');
      } else {
        createNewSession(data?.models[0] || '');
      }
    }
  }

  // 清空当前会话
  function clearActiveSession() {
    if (!activeSessionId) return;
    const updated = sessions.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, title: '新的对话', messages: [] };
      }
      return s;
    });
    setSessions(updated);
    saveHistory(updated);
  }

  // 修改当前会话的模型
  function handleModelChange(model: string) {
    setSelectedModel(model);
    if (!activeSessionId) return;
    const updated = sessions.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, selectedModel: model };
      }
      return s;
    });
    setSessions(updated);
    saveHistory(updated);
  }

  // 退出登录
  function handleLogout() {
    if (confirm('确认退出登录吗？退出后聊天历史将保留在本地，但无法继续聊天。')) {
      localStorage.removeItem('nc_cache');
      setData(null);
      setSessions([]);
      setActiveSessionId(null);
    }
  }

  // 复制文本反馈
  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 1500);
  }

  // 5. 发送消息（支持流式响应）
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isGenerating || !activeSessionId || !data) return;

    const userMessageContent = input.trim();
    setInput('');
    setIsStreaming(true);

    const activeSession = sessions.find(s => s.id === activeSessionId)!;
    
    // 构造新消息
    const userMsg: Message = {
      id: Math.random().toString(36).slice(2, 11),
      role: 'user',
      content: userMessageContent,
      timestamp: Date.now()
    };

    const assistantMsgId = Math.random().toString(36).slice(2, 11);
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    };

    // 更新内存中的会话状态
    const updatedMessages = [...activeSession.messages, userMsg, assistantMsg];
    const sessionTitle = activeSession.messages.length === 0 
      ? (userMessageContent.slice(0, 16) + (userMessageContent.length > 16 ? '...' : ''))
      : activeSession.title;

    const updatedSessions = sessions.map(s => {
      if (s.id === activeSessionId) {
        return {
          ...s,
          title: sessionTitle,
          messages: updatedMessages,
          selectedModel: selectedModel
        };
      }
      return s;
    });

    setSessions(updatedSessions);

    // 建立中止控制器以支持“停止生成”
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // 通过 proxy API 路径发送 OpenAI Chat 格式请求
      const chatMessages = updatedMessages.slice(0, -1).map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${data.api_key}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: chatMessages,
          stream: true
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `服务器返回错误 ${response.status}`);
      }

      if (!response.body) {
        throw new Error('响应流建立失败');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;
          if (cleanLine === 'data: [DONE]') continue;
          if (!cleanLine.startsWith('data: ')) continue;

          try {
            const rawJson = cleanLine.slice(6);
            const parsed = JSON.parse(rawJson);
            const delta = parsed?.choices?.[0]?.delta?.content || '';
            if (delta) {
              accumulatedContent += delta;
              
              // 实时更新前端 UI 气泡
              setSessions(prevSessions => 
                prevSessions.map(s => {
                  if (s.id === activeSessionId) {
                    return {
                      ...s,
                      messages: s.messages.map(m => {
                        if (m.id === assistantMsgId) {
                          return { ...m, content: accumulatedContent };
                        }
                        return m;
                      })
                    };
                  }
                  return s;
                })
              );
            }
          } catch {
            // 解析单行错误忽略，可能是部分数据
          }
        }
      }

      // 完成后，持久化聊天记录
      setSessions(prevSessions => {
        saveHistory(prevSessions);
        return prevSessions;
      });

    } catch (err: any) {
      if (err.name === 'AbortError') {
        logMessage('[SYSTEM] 停止生成');
      } else {
        const errorText = `\n[错误] ${err.message || '网络连接被切断，请稍后重试'}`;
        setSessions(prevSessions => {
          const finalSessions = prevSessions.map(s => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: s.messages.map(m => {
                  if (m.id === assistantMsgId) {
                    return { ...m, content: m.content + errorText };
                  }
                  return m;
                })
              };
            }
            return s;
          });
          saveHistory(finalSessions);
          return finalSessions;
        });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }

  function logMessage(text: string) {
    console.log(text);
  }

  // 停止生成
  function handleStop() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  }

  const currentSession = sessions.find(s => s.id === activeSessionId);

  // 未登录时的全屏磨砂遮罩
  if (!data) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/60 p-8 shadow-2xl backdrop-blur">
          <div className="text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/10 text-brand-400">
              <Sparkles className="h-6 w-6 animate-pulse" />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-slate-100">在线智能对话</h1>
            <p className="mt-2 text-sm text-slate-400">
              请输入您的 API Key 即刻在线使用 DeepSeek / GPT / Claude 等全系列模型
            </p>
          </div>

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                API Key (sk-...)
              </label>
              <input
                type="text"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="sk-XXXX..."
                className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 font-mono tracking-wider text-slate-100 placeholder:text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {authError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading || !inputKey}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {authLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  验证中...
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4" />
                  进入对话中心
                </>
              )}
            </button>
          </form>

          <button
            onClick={() => router.push('/')}
            className="mt-6 flex w-full items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-slate-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回卡密激活中心
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* 1. 侧边栏 (会话历史) */}
      <div className="hidden md:flex flex-col w-64 bg-slate-900 border-r border-slate-800 flex-shrink-0">
        {/* 新对话按钮 */}
        <div className="p-4 border-b border-slate-800">
          <button
            onClick={() => createNewSession(data.models[0])}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand-500/40 bg-brand-500/5 px-4 py-2.5 text-sm font-medium text-brand-400 transition hover:bg-brand-500/15"
          >
            <Plus className="h-4 w-4" />
            新建对话
          </button>
        </div>

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => {
                setActiveSessionId(s.id);
                setSelectedModel(s.selectedModel || data.models[0]);
              }}
              className={`group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm cursor-pointer transition ${
                s.id === activeSessionId
                  ? 'bg-slate-800 text-slate-100 font-medium'
                  : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <MessageSquare className={`h-4 w-4 shrink-0 ${s.id === activeSessionId ? 'text-brand-400' : 'text-slate-500'}`} />
                <span className="truncate pr-1">{s.title}</span>
              </div>
              <button
                onClick={(e) => deleteSession(s.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400 transition"
                title="删除会话"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* 侧边栏底部用户信息 */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 space-y-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center text-brand-400 shrink-0">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-300 truncate">
                {data.category_label || '专属套餐'}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                RPH 限制: {data.rph > 0 ? `${data.rph}次/小时` : '不限'}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => router.push('/result')}
              className="flex-1 flex items-center justify-center gap-1 rounded border border-slate-700 bg-slate-800/40 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
              title="卡密详情"
            >
              <Zap className="h-3 w-3 text-brand-400" />
              卡密详情
            </button>
            <button
              onClick={handleLogout}
              className="px-2 rounded border border-slate-700 bg-slate-800/40 py-1.5 text-slate-400 hover:text-red-400 hover:border-red-500/30 transition"
              title="退出登录"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. 主聊天区 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950">
        {/* 顶栏 */}
        <header className="flex h-14 items-center justify-between border-b border-slate-800 px-4 md:px-6 bg-slate-900/40 shrink-0 backdrop-blur">
          <div className="flex items-center gap-3">
            {/* 移动端返回按钮 */}
            <button
              onClick={() => router.push('/result')}
              className="md:hidden p-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-slate-100">AI 智能终端</h2>
              <span className="text-xs text-slate-500 hidden sm:inline">({data.category_label})</span>
            </div>
          </div>

          {/* 模型选择下拉菜单 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 hidden sm:inline">模型:</span>
            <select
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-mono font-medium text-slate-200 focus:border-brand-500 focus:outline-none"
              disabled={isGenerating}
            >
              {data.models.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </header>

        {/* 聊天内容列表 */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-thin">
          {currentSession && currentSession.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full max-w-lg mx-auto text-center space-y-6">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/30 shadow-lg shadow-brand-500/5">
                <Bot className="h-7 w-7" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-100">在线使用已准备就绪</h3>
                <p className="text-sm text-slate-400">
                  您可以用当前套餐额度直接提问。支持 Markdown，且在整点后自动刷新额度。
                </p>
              </div>

              {/* 模型快捷推荐 */}
              <div className="grid grid-cols-2 gap-3 w-full max-w-md text-left">
                {data.models.slice(0, 4).map(m => (
                  <button
                    key={m}
                    onClick={() => handleModelChange(m)}
                    className={`rounded-lg border p-3 font-mono text-xs transition text-left ${
                      m === selectedModel
                        ? 'border-brand-500/50 bg-brand-500/5 text-brand-300'
                        : 'border-slate-800 bg-slate-900/30 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-brand-400" />
                      <span className="font-semibold truncate">{m}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {currentSession?.messages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={m.id}
                    className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    {/* 头像 */}
                    {!isUser && (
                      <div className="h-8 w-8 rounded-full border border-brand-500/20 bg-brand-500/10 text-brand-400 flex items-center justify-center shrink-0">
                        <Bot className="h-4.5 w-4.5" />
                      </div>
                    )}

                    <div className={`flex flex-col gap-1.5 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                      {/* 气泡内容 */}
                      <div
                        className={`rounded-2xl px-4 py-3 shadow-md backdrop-blur ${
                          isUser
                            ? 'bg-slate-800 text-slate-100 border border-slate-700'
                            : 'bg-slate-900/80 text-slate-100 border border-slate-800'
                        }`}
                      >
                        {/* 简易的代码/Markdown排版：普通文本换行+代码包裹 */}
                        <div className="text-sm leading-relaxed whitespace-pre-wrap font-sans break-words selection:bg-brand-500/30">
                          {m.content}
                        </div>
                      </div>

                      {/* 辅助操作 (复制/时间) */}
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 px-1">
                        <span>{new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        {!isUser && m.content && (
                          <button
                            onClick={() => copyToClipboard(m.content, m.id)}
                            className="hover:text-slate-300 flex items-center gap-0.5"
                          >
                            {copiedText === m.id ? (
                              <>
                                <Check className="h-2.5 w-2.5 text-emerald-400" />
                                <span className="text-emerald-400">已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-2.5 w-2.5" />
                                <span>复制</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 用户头像 */}
                    {isUser && (
                      <div className="h-8 w-8 rounded-full border border-slate-700 bg-slate-800 text-slate-300 flex items-center justify-center shrink-0">
                        <User className="h-4.5 w-4.5" />
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 底部输入框 */}
        <footer className="border-t border-slate-800 px-4 py-4 md:px-6 shrink-0 bg-slate-900/20 backdrop-blur">
          <div className="max-w-3xl mx-auto">
            <form onSubmit={handleSend} className="flex gap-2 relative items-end">
              {/* 停止按钮 */}
              {isGenerating && (
                <button
                  type="button"
                  onClick={handleStop}
                  className="absolute -top-12 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 shadow-md backdrop-blur transition animate-bounce"
                >
                  <Square className="h-3 w-3 fill-red-400" />
                  停止生成
                </button>
              )}

              {/* 输入框 */}
              <div className="flex-1 relative">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend(e);
                    }
                  }}
                  placeholder={`给 ${selectedModel} 发送消息... (Enter 发送, Shift+Enter 换行)`}
                  rows={Math.min(5, input.split('\n').length || 1)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3.5 pr-12 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 resize-none font-sans scrollbar-thin"
                  disabled={isGenerating}
                />
                
                {/* 清空会话图标 */}
                {currentSession && currentSession.messages.length > 0 && (
                  <button
                    type="button"
                    onClick={clearActiveSession}
                    className="absolute right-3 bottom-3.5 text-slate-600 hover:text-slate-400 p-1 rounded-md transition"
                    title="清空当前对话"
                    disabled={isGenerating}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* 发送按钮 */}
              <button
                type="submit"
                disabled={isGenerating || !input.trim()}
                className="h-12 w-12 flex items-center justify-center rounded-xl bg-brand-500 text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600 transition flex-shrink-0"
              >
                {isGenerating ? (
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </button>
            </form>
            
            <p className="mt-2 text-center text-[10px] text-slate-600 leading-normal">
              使用本系统即代表接受速率规范：当前套餐每小时最大限制 {data.rph > 0 ? `${data.rph}次` : '不限'}，超出后将在整点自动恢复。
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}
