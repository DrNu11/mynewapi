// 全局 Auth Context + useAuth() hook
//
// NewAPI 用 session cookie,不是 JWT。所以 "登录状态" = "cookie 在且能成功调 /api/user/self"。
// 我们只缓存 user 对象,不存任何 token / 不操作 localStorage。
//
// 用法:
//   const { user, loading, login, logout, refresh } = useAuth();
//   if (!user && !loading) router.push("/login");
//
// 在 app/layout.tsx 顶层包 <AuthProvider>。

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setApiUserId, UnauthorizedError, type UserSelf } from "@/lib/api";

// NewAPI login response 只返回部分字段(不含 quota),refresh 时调 self 拿全
type LoginResp = Pick<UserSelf, "id" | "username" | "display_name" | "role" | "status" | "group">;

type AuthCtx = {
  user: UserSelf | null;
  loading: boolean;                                              // 初次 mount 时拿 self 的状态
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<UserSelf | null>;                       // 强制重新拿 self(充值/key 变动后用)
};

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserSelf | null>(null);
  const [loading, setLoading] = useState(true);

  // 拉一次 /api/user/self — 401 视为未登录,不抛错
  // 注意:此函数依赖 localStorage 里的 user_id(New-Api-User header);
  // 若 user_id 缺失会被服务端拒(401),前端正确处理为未登录。
  const refresh = useCallback(async () => {
    try {
      const me = await api.get<UserSelf>("user/self");
      setUser(me);
      setApiUserId(me.id); // 保险:确保 user_id 跟服务端实际一致
      return me;
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setUser(null);
        setApiUserId(null);
        return null;
      }
      // 其他错误(网络/5xx)不清 user,避免误判
      console.error("auth.refresh failed:", err);
      throw err;
    }
  }, []);

  // 首次 mount:自检登录态
  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(
    async (username: string, password: string) => {
      // NewAPI login 返回 partial user (id/username/display_name/role/status/group)
      // 关键:从 login response 拿到 id,立即存进 localStorage
      // 否则后续 refresh() 调 self 时没有 New-Api-User header 会被服务端拒
      const partial = await api.post<LoginResp>("user/login", { username, password });
      if (partial?.id) {
        setApiUserId(partial.id);
      }
      await refresh(); // 用刚存的 id 拉完整 user 信息
    },
    [refresh]
  );

  const register = useCallback(
    async (username: string, password: string) => {
      await api.post("user/register", { username, password });
      // NewAPI register 不自动建 session,需要登录一次
      await login(username, password);
    },
    [login]
  );

  const logout = useCallback(async () => {
    try {
      await api.get("user/logout");
    } catch {
      // 即使后端登出失败,本地也清掉 user
    }
    setUser(null);
    setApiUserId(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
