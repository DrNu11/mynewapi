// 路由保护组件 — 包在需要登录的页面外层
//
// 用法:
//   export default function DashboardPage() {
//     return (
//       <RequireAuth>
//         <RealDashboardContent />
//       </RequireAuth>
//     );
//   }
//
// 行为:
//   - loading:显示居中 spinner
//   - 未登录:`router.replace("/login?next=" + 当前路径)`,渲染 null 避免闪烁
//   - 已登录:渲染 children

"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      const next = encodeURIComponent(pathname || "/dashboard");
      router.replace(`/login?next=${next}`);
    }
  }, [loading, user, router, pathname]);

  if (loading) {
    return (
      <div className="container py-24 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    // 跳转中,渲染 null 避免一闪即逝的内容
    return null;
  }

  return <>{children}</>;
}
