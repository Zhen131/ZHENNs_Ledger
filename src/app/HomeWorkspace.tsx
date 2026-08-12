import type { ReactNode } from "react";

export function HomeWorkspace({
  active,
  children,
}: Readonly<{ active: boolean; children: ReactNode }>) {
  return (
    <section
      aria-label="首页工作区"
      className={active ? "grid min-w-0 gap-5" : "hidden"}
      data-workspace-page="home"
    >
      {children}
    </section>
  );
}
