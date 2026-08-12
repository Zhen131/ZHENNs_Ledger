import type { SVGProps } from "react";

export type LedgerIconName =
  | "home"
  | "record"
  | "transactions"
  | "transfer"
  | "settings"
  | "lock"
  | "file"
  | "check"
  | "warning"
  | "arrow-right"
  | "close";

const ICON_PATHS: Record<LedgerIconName, React.ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9v11h14V9M9 20v-6h6v6" />
    </>
  ),
  record: (
    <>
      <path d="M12 3v18M3 12h18" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  transactions: (
    <>
      <path d="M4 7h15M4 12h15M4 17h10" />
      <path d="m16 15 3 2-3 2" />
    </>
  ),
  transfer: (
    <>
      <path d="M5 7h13M15 4l3 3-3 3M19 17H6M9 14l-3 3 3 3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.12-1.27l2-1.55-2-3.46-2.47 1A7 7 0 0 0 14.2 5.4L13.82 3h-4l-.38 2.4a7 7 0 0 0-2.21 1.32l-2.47-1-2 3.46 2 1.55A7 7 0 0 0 4.64 12c0 .43.04.85.12 1.27l-2 1.55 2 3.46 2.47-1a7 7 0 0 0 2.21 1.32l.38 2.4h4l.38-2.4a7 7 0 0 0 2.21-1.32l2.47 1 2-3.46-2-1.55c.08-.42.12-.84.12-1.27Z" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h8l4 4v16H6z" />
      <path d="M14 2v5h5M9 12h6M9 16h6" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  warning: (
    <>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v5M12 17h.01" />
    </>
  ),
  "arrow-right": <path d="M5 12h14m-5-5 5 5-5 5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
};

export function LedgerIcon({
  name,
  title,
  ...props
}: Readonly<
  SVGProps<SVGSVGElement> & {
    name: LedgerIconName;
    title?: string;
  }
>) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      fill="none"
      role={title ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {ICON_PATHS[name]}
    </svg>
  );
}
