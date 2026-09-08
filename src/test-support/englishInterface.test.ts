import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  LEDGER_TRANSLATION_TABLES,
  TRANSLATION_GLOSSARY,
  type GlossaryTerm,
  type TranslationKey,
} from "@/ui";

/**
 * The English interface used to rot in silence: a key with no English entry
 * falls back to Chinese, so the screen looks fine and reads entirely in
 * Chinese. Coverage sat at 2.6% for months without one test noticing. These
 * five guards make each way it can rot turn a test red instead (04A D-2, D-9,
 * D-12, D-13).
 *
 * Hungarian is deliberately outside every guard here. It is a partial
 * translation kept for the day the option returns, and holding it to the same
 * completeness bar would either block this batch or force a machine
 * translation nobody has reviewed (04A D-3d).
 */
const SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));
// The two files that hold Chinese as data rather than as interface wording:
// the message table itself, and the glossary whose left-hand column is by
// definition Chinese words. Both are named individually, not by directory.
const MESSAGE_TABLE_FILE = "ui/i18n.tsx";
const GLOSSARY_FILE = "ui/translationGlossary.ts";
const HAN = /[㐀-䶿一-鿿]/;

const chinese = LEDGER_TRANSLATION_TABLES["zh-CN"];
const english = LEDGER_TRANSLATION_TABLES.en;
const chineseKeys = Object.keys(chinese) as TranslationKey[];

/**
 * Keys deliberately left without an English entry. Each line says why, because
 * a blanket prefix would let a whole area rot unnoticed (04A D-2a).
 */
const ENGLISH_COVERAGE_EXEMPTIONS = new Map<string, string>([
  [
    "shared.i18n.fallbackExample",
    "The fixture that proves the Chinese fallback; giving it English would delete the proof (i18nMechanism T-A4).",
  ],
]);

/**
 * Glossary terms that do not apply to one particular message, because the
 * Chinese word appears there in a different sense. Keyed by message key and
 * Chinese term so a wildcard cannot silently cover a whole area (04A D-12d).
 */
const GLOSSARY_EXEMPTIONS = new Map<string, string>([
  [
    "home.trend.description|只读",
    "「只读取」 here is “reads only”, not the read-only protection state.",
  ],
  [
    "assets.error.limitReached|数量",
    "「资产数量」 counts how many assets exist, not a held asset quantity.",
  ],
  [
    "portfolio.overview.column.asset|币种",
    "This holdings column header labels the held asset, not the currency it is priced in.",
  ],
  [
    "marketData.failure.symbolNotTrading|交易",
    "The trailing 交易 is the verb “to trade”, not a ledger transaction.",
  ],
]);

/**
 * Message keys nothing in the product reads any more. Each line says why the
 * key survives, because a prefix wildcard would hide the next dead key
 * (04A D-9b).
 */
const ORPHAN_KEY_EXEMPTIONS = new Map<string, string>([
  [
    "shared.i18n.fallbackExample",
    "Exists only so a test can prove the Chinese fallback still works.",
  ],
  [
    "settings.language.optionHungarian",
    "Kept for the day the Hungarian option returns to the picker (04A D-3d).",
  ],
]);

/**
 * Chinese string literals allowed to stay in shipped source, one line each.
 * The scan covers every tracked .ts/.tsx under src/ except files whose name
 * marks them as tests or test scaffolding (*.test.*, *.testHelpers.*), whose
 * strings never reach a browser; that scope is stated here rather than hidden
 * in a path pattern, and nothing inside the shipped scope is waved through by
 * directory (04A H-2, 04B S-5c).
 */
const SHIPPED_CHINESE_EXEMPTIONS: readonly Readonly<{
  file: string;
  text: string;
  reason: string;
}>[] = [
  {
    file: "platform/persistence/ledgerRepository.ts",
    text: "清空当前C账本",
    reason:
      "The clear-authorization nonce two repository layers compare against; translating it would change an authorization protocol, not wording.",
  },
  {
    file: "test-support/fixtures.ts",
    text: "虚构样例：以 10 USDT 买入 2 BTC。",
    reason: "Fixture rawText for a fictional trade; never rendered.",
  },
  {
    file: "test-support/fixtures.ts",
    text: "虚构样例：以 8 USDT 买入 3 ETH。",
    reason: "Fixture rawText for a fictional trade; never rendered.",
  },
  {
    file: "test-support/fixtures.ts",
    text: "虚构样例：以 2 USDT 买入 10 ADA。",
    reason: "Fixture rawText for a fictional trade; never rendered.",
  },
  {
    file: "test-support/fixtures.ts",
    text: "虚构样例：以 2 USDT 买入 20 ADA。",
    reason: "Fixture rawText for a fictional trade; never rendered.",
  },
  {
    file: "test-support/fixtures.ts",
    text: "虚构样例：以 4 USDT 卖出 15 ADA。",
    reason: "Fixture rawText for a fictional trade; never rendered.",
  },
];

describe("English interface completeness", () => {
  it("gives every Chinese message an English one", () => {
    const missing = chineseKeys
      .filter((key) => english[key] === undefined)
      .filter((key) => !ENGLISH_COVERAGE_EXEMPTIONS.has(key));

    expect(
      missing,
      `Chinese messages with no English entry (${missing.length}):\n${missing.join("\n")}`,
    ).toEqual([]);

    const staleExemptions = [...ENGLISH_COVERAGE_EXEMPTIONS.keys()].filter(
      (key) => !(key in chinese) || english[key as TranslationKey] !== undefined,
    );
    expect(staleExemptions, "Stale English-coverage exemptions").toEqual([]);
  });

  it("keeps Chinese characters out of English messages and shipped source", () => {
    const englishWithHan = Object.entries(english)
      .filter(([, value]) => HAN.test(value ?? ""))
      .map(([key, value]) => `${key}: ${value}`);
    expect(
      englishWithHan,
      `English messages containing Chinese characters (${englishWithHan.length}):\n${englishWithHan.join("\n")}`,
    ).toEqual([]);

    const exempt = new Set(
      SHIPPED_CHINESE_EXEMPTIONS.map(({ file, text }) => `${file}|${text}`),
    );
    const found = shippedChineseStringLiterals();
    const unexplained = found
      .filter(({ file, text }) => !exempt.has(`${file}|${text}`))
      .map(({ file, line, text }) => `${file}:${line}: ${text}`);
    expect(
      unexplained,
      `Chinese string literals in shipped source (${unexplained.length}):\n${unexplained.join("\n")}`,
    ).toEqual([]);

    const seen = new Set(found.map(({ file, text }) => `${file}|${text}`));
    const staleExemptions = [...exempt].filter((entry) => !seen.has(entry));
    expect(staleExemptions, "Stale shipped-Chinese exemptions").toEqual([]);
  });

  it("translates every glossary term the one agreed way", () => {
    const violations: string[] = [];

    for (const key of chineseKeys) {
      const englishValue = english[key];
      if (englishValue === undefined) continue;
      for (const term of requiredTerms(chinese[key] ?? "")) {
        if (GLOSSARY_EXEMPTIONS.has(`${key}|${term.chinese}`)) continue;
        if (!englishUsesTerm(englishValue, term)) {
          violations.push(
            `${key}: 「${term.chinese}」 must read "${term.english}"\n    zh: ${chinese[key]}\n    en: ${englishValue}`,
          );
        }
      }
    }

    expect(
      violations,
      `English messages that drop a pinned term (${violations.length}):\n${violations.join("\n")}`,
    ).toEqual([]);

    const staleExemptions = [...GLOSSARY_EXEMPTIONS.keys()].filter((entry) => {
      const [key, term] = entry.split("|");
      const value = english[key as TranslationKey];
      const glossaryTerm = TRANSLATION_GLOSSARY.find(
        (candidate) => candidate.chinese === term,
      );
      if (value === undefined || glossaryTerm === undefined) return true;
      return (
        !requiredTerms(chinese[key as TranslationKey] ?? "").some(
          (candidate) => candidate.chinese === term,
        ) || englishUsesTerm(value, glossaryTerm)
      );
    });
    expect(staleExemptions, "Stale glossary exemptions").toEqual([]);
  });

  it("keeps every joined sentence the same number of segments", () => {
    const chineseGroups = fragmentGroups(chineseKeys);
    const shortfalls: string[] = [];

    for (const [root, keys] of chineseGroups) {
      if (keys.length < 2) continue;
      const translated = keys.filter((key) => english[key] !== undefined);
      if (translated.length !== keys.length) {
        const absent = keys.filter((key) => english[key] === undefined);
        shortfalls.push(
          `${root}: Chinese has ${keys.length} segments, English has ${translated.length}; missing ${absent.join(", ")}`,
        );
      }
    }

    expect(
      shortfalls,
      `Joined sentences missing an English segment (${shortfalls.length}):\n${shortfalls.join("\n")}`,
    ).toEqual([]);
  });

  it("leaves no message key that nothing reads", () => {
    const referenced = referencedStringLiterals();
    const orphans = chineseKeys
      .filter((key) => !referenced.has(key))
      .filter((key) => !ORPHAN_KEY_EXEMPTIONS.has(key));

    expect(
      orphans,
      `Message keys nothing reads (${orphans.length}):\n${orphans.join("\n")}`,
    ).toEqual([]);

    const staleExemptions = [...ORPHAN_KEY_EXEMPTIONS.keys()].filter(
      (key) => !(key in chinese),
    );
    expect(staleExemptions, "Stale orphan-key exemptions").toEqual([]);
  });
});

function requiredTerms(chineseValue: string): GlossaryTerm[] {
  // Longest term first, and the characters a longer term consumes are not
  // offered to a shorter one, so "交易所" is never also asked to say
  // "transaction" (04A D-12c).
  const byLength = [...TRANSLATION_GLOSSARY].sort(
    (left, right) => right.chinese.length - left.chinese.length,
  );
  let masked = chineseValue;
  const needed: GlossaryTerm[] = [];

  for (const term of byLength) {
    let index = masked.indexOf(term.chinese);
    if (index < 0) continue;
    while (index >= 0) {
      masked =
        masked.slice(0, index) +
        " ".repeat(term.chinese.length) +
        masked.slice(index + term.chinese.length);
      index = masked.indexOf(term.chinese);
    }
    needed.push(term);
  }

  return needed;
}

function englishUsesTerm(englishValue: string, term: GlossaryTerm): boolean {
  return [term.english, ...(term.inflections ?? [])].some((form) =>
    matchesForm(englishValue, form),
  );
}

function matchesForm(englishValue: string, form: string): boolean {
  const pattern = form
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  // Case-insensitive, any run of whitespace between words, and the regular
  // English endings on the final word (04A D-12c).
  return new RegExp(
    `(?<![A-Za-z])${pattern}(?:s|es|ed|d|ing)?(?![A-Za-z])`,
    "i",
  ).test(englishValue);
}

function fragmentGroups(keys: readonly TranslationKey[]) {
  const groups = new Map<string, TranslationKey[]>();
  for (const key of keys) {
    const match = /(Prefix|Middle|Suffix|Separator)\d*$/.exec(key);
    if (!match) continue;
    const root = key.slice(0, key.length - match[0].length);
    groups.set(root, [...(groups.get(root) ?? []), key]);
  }
  return groups;
}

function shippedChineseStringLiterals(): {
  file: string;
  line: number;
  text: string;
}[] {
  const found: { file: string; line: number; text: string }[] = [];

  for (const filePath of shippedSourceFiles()) {
    const relativePath = sourcePath(filePath);
    if (relativePath === MESSAGE_TABLE_FILE) continue;
    if (relativePath === GLOSSARY_FILE) continue;
    const source = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      extname(filePath) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node): void => {
      if (
        (ts.isStringLiteralLike(node) || ts.isJsxText(node)) &&
        HAN.test(node.text)
      ) {
        found.push({
          file: relativePath,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
          text: node.text,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return found;
}

function referencedStringLiterals(): Set<string> {
  const referenced = new Set<string>();

  for (const filePath of collectTypeScriptFiles(SRC_ROOT)) {
    if (sourcePath(filePath) === MESSAGE_TABLE_FILE) continue;
    const source = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      extname(filePath) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node)) referenced.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return referenced;
}

function shippedSourceFiles(): string[] {
  return collectTypeScriptFiles(SRC_ROOT).filter((filePath) => {
    const name = filePath.split("/").pop() ?? "";
    return !/\.test\.tsx?$/.test(name) && !/\.testHelpers\.tsx?$/.test(name);
  });
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [entryPath] : [];
  });
}

function sourcePath(filePath: string): string {
  return relative(SRC_ROOT, filePath).split(/[\\/]/).join("/");
}
