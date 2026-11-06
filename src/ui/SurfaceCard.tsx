/**
 * 这个文件放各个页面共用的白底圆角卡片外框。
 * 卡片里放什么由用它的页面定。
 * 没有特别的决定。
 */
import type { ComponentPropsWithoutRef } from "react";

/**
 * 这个组件画一张圆角带阴影的卡片，里面装传进来的内容。
 * 别的属性原样交给外面那层 `section`。
 */
export function SurfaceCard({
  className = "",
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<"section">>) {
  return (
    <section
      className={`rounded-[20px] border border-[var(--ledger-border)] bg-[var(--ledger-surface)] shadow-[var(--ledger-shadow-soft)] ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}
