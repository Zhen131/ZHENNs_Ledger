/**
 * 这个文件是 Next.js 规定的首页入口，整个账本只有这一个页面。
 * 进账本前的检查在 `app/gate`，界面语言在 `ui/i18n.tsx`。
 * 没有特别的决定。
 */
import { LedgerAccessGate } from "@/app/gate";
import { LanguageProvider } from "@/ui";

/**
 * 这个组件画整个账本应用。
 * 外面套上界面语言，里面是进账本前的那道检查。
 * 选文件、输密码、新建都从这里开始，过了检查才看到账本。
 */
export default function Home() {
  return (
    <LanguageProvider>
      <LedgerAccessGate />
    </LanguageProvider>
  );
}
