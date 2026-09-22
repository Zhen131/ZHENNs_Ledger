import { LedgerAccessGate } from "@/app/gate";
import { LanguageProvider } from "@/ui";

export default function Home() {
  return (
    <LanguageProvider>
      <LedgerAccessGate />
    </LanguageProvider>
  );
}
