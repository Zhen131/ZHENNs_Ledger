import { LedgerAccessGate } from "./LedgerAccessGate";
import { LanguageProvider } from "@/ui";

export default function Home() {
  return (
    <LanguageProvider>
      <LedgerAccessGate />
    </LanguageProvider>
  );
}
