import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_AREAS = [
  "app",
  "core",
  "features",
  "platform",
  "test-support",
  "ui",
] as const;
const LEGACY_TOP_LEVEL_AREAS = [
  "adapters",
  "backup",
  "calculators",
  "components",
  "composition",
  "coordination",
  "data",
  "encryption",
  "hooks",
  "marketData",
  "models",
  "policies",
  "repositories",
  "services",
  "state",
  "test",
  "utils",
  "validators",
] as const;
const FEATURES = [
  "backup",
  "charts",
  "fees",
  "market-data",
  "portfolio",
  "prices",
  "trades",
] as const;
const CORE_AREAS = [
  "calculations",
  "catalog",
  "models",
  "policies",
  "shared",
  "state",
  "validation",
] as const;
const PLATFORM_AREAS = [
  "coordination",
  "encryption",
  "files",
  "integrations",
  "legacy",
  "persistence",
] as const;
const PUBLIC_PLATFORM_SUBENTRIES = new Set([
  "@/platform/persistence/identity",
]);

describe("source layout", () => {
  it("keeps only the six responsibility areas and README at the src root", () => {
    const entries = readdirSync(SRC_ROOT, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();

    expect(entries).toEqual([...SOURCE_AREAS, "README.md"].sort());
  });

  it("does not restore any legacy top-level area", () => {
    const entries = new Set(readdirSync(SRC_ROOT));

    for (const area of LEGACY_TOP_LEVEL_AREAS) {
      expect(entries.has(area), area).toBe(false);
    }
  });

  it("keeps every feature flat with separate logic and UI entries", () => {
    for (const feature of FEATURES) {
      const featureRoot = join(SRC_ROOT, "features", feature);
      const entries = readdirSync(featureRoot, { withFileTypes: true });

      expect(entries.some((entry) => entry.name === "index.ts"), feature).toBe(
        true,
      );
      expect(entries.some((entry) => entry.name === "ui.ts"), feature).toBe(
        true,
      );
      expect(
        entries.filter((entry) => entry.isDirectory()),
        `${feature} must remain flat`,
      ).toEqual([]);
    }
  });

  it("keeps every stable entry point", () => {
    for (const area of CORE_AREAS) {
      expect(fileNames(join(SRC_ROOT, "core", area))).toContain("index.ts");
    }
    for (const area of PLATFORM_AREAS) {
      expect(fileNames(join(SRC_ROOT, "platform", area))).toContain(
        "index.ts",
      );
    }
    expect(fileNames(join(SRC_ROOT, "platform", "persistence"))).toContain(
      "identity.ts",
    );
    for (const area of ["app", "ui", "test-support"] as const) {
      expect(fileNames(join(SRC_ROOT, area))).toContain("index.ts");
    }
  });

  it("keeps tracked TypeScript imports on the stable source contract", () => {
    const violations: string[] = [];

    for (const file of sourceFiles(SRC_ROOT)) {
      for (const sourceImport of sourceImports(file)) {
        const { line, specifier } = sourceImport;
        const reason = importViolation(specifier);
        if (reason) {
          violations.push(
            `${sourcePath(file)}:${line}: ${specifier} (${reason})`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("prevents every source area from importing its own stable entry", () => {
    const violations = sourceFiles(SRC_ROOT).flatMap((file) =>
      sourceImports(file)
        .filter(({ specifier }) => isSelfStableEntryImport(file, specifier))
        .map(
          ({ line, specifier }) =>
            `${sourcePath(file)}:${line}: ${specifier} (self stable-entry import)`,
        ),
    );

    expect(
      violations,
      `Self stable-entry imports (${violations.length}):\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the complete static TypeScript dependency graph acyclic", () => {
    const graph = sourceDependencyGraph();
    const cycles = dependencyCycles(graph);
    const involvedFileCount = cycles.reduce(
      (count, component) => count + component.length,
      0,
    );
    const details = cycles.map((component) => describeCycle(component, graph));

    expect(
      cycles,
      `Static dependency cycles (${cycles.length} groups / ${involvedFileCount} files):\n${details.join("\n\n")}`,
    ).toEqual([]);
  });
});

type SourceImport = Readonly<{
  line: number;
  specifier: string;
  target?: string;
}>;

type SourceDependencyGraph = Readonly<{
  edges: ReadonlyMap<string, readonly SourceImport[]>;
  files: readonly string[];
}>;

function fileNames(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function importViolation(specifier: string): string | undefined {
  if (specifier.startsWith("../")) {
    return "parent-relative import";
  }
  if (/^@\/core\/[^/]+\/.+/.test(specifier)) {
    return "deep core import";
  }
  if (
    /^@\/platform\/[^/]+\/.+/.test(specifier) &&
    !PUBLIC_PLATFORM_SUBENTRIES.has(specifier)
  ) {
    return "deep platform import";
  }
  if (/^@\/features\/[^/]+\/(?!ui$).+/.test(specifier)) {
    return "deep feature import";
  }
  if (/^@\/(?:app|ui|test-support)\/.+/.test(specifier)) {
    return "deep top-level entry import";
  }
  if (
    specifier.startsWith("@/") &&
    !/^@\/(?:core\/[^/]+|platform\/(?:[^/]+|persistence\/identity)|features\/[^/]+(?:\/ui)?|app|ui|test-support)$/.test(
      specifier,
    )
  ) {
    return "unsupported source alias";
  }
  if (specifier.startsWith("@root") && specifier !== "@root/package.json") {
    return "unsupported root import";
  }
  return undefined;
}

function isSelfStableEntryImport(file: string, specifier: string): boolean {
  const stableEntry = owningStableEntry(file);
  return (
    stableEntry !== undefined &&
    (specifier === stableEntry || specifier.startsWith(`${stableEntry}/`))
  );
}

function owningStableEntry(file: string): string | undefined {
  const [area, child] = sourcePath(file).split("/");
  if (["core", "features", "platform"].includes(area) && child) {
    return `@/${area}/${child}`;
  }
  if (["app", "test-support", "ui"].includes(area)) {
    return `@/${area}`;
  }
  return undefined;
}

function sourceImports(file: string): SourceImport[] {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: SourceImport[] = [];

  function record(node: ts.Node, moduleSpecifier: ts.Expression): void {
    if (!ts.isStringLiteralLike(moduleSpecifier)) {
      return;
    }
    imports.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        .line + 1,
      specifier: moduleSpecifier.text,
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        record(node, node.moduleSpecifier);
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      record(node, node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument)) {
        record(node, argument.literal);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0]
    ) {
      record(node, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function sourceDependencyGraph(): SourceDependencyGraph {
  const files = sourceFiles(SRC_ROOT).sort();
  const fileSet = new Set(files);
  const edges = new Map<string, SourceImport[]>();

  for (const file of files) {
    const imports = sourceImports(file).flatMap((sourceImport) => {
      const target = resolveSourceImport(file, sourceImport.specifier);
      return target && fileSet.has(target)
        ? [{ ...sourceImport, target }]
        : [];
    });
    edges.set(file, imports);
  }

  return { edges, files };
}

function resolveSourceImport(
  importer: string,
  specifier: string,
): string | undefined {
  let unresolved: string;
  if (specifier.startsWith("@/")) {
    unresolved = join(SRC_ROOT, specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    unresolved = resolve(dirname(importer), specifier);
  } else {
    return undefined;
  }

  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    join(unresolved, "index.ts"),
    join(unresolved, "index.tsx"),
  ];
  return candidates.find(
    (candidate) =>
      existsSync(candidate) && [".ts", ".tsx"].includes(extname(candidate)),
  );
}

function dependencyCycles(graph: SourceDependencyGraph): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function connect(file: string): void {
    indices.set(file, nextIndex);
    lowLinks.set(file, nextIndex);
    nextIndex += 1;
    stack.push(file);
    onStack.add(file);

    for (const edge of graph.edges.get(file) ?? []) {
      const target = edge.target;
      if (!target) {
        continue;
      }
      if (!indices.has(target)) {
        connect(target);
        lowLinks.set(
          file,
          Math.min(lowLinks.get(file)!, lowLinks.get(target)!),
        );
      } else if (onStack.has(target)) {
        lowLinks.set(
          file,
          Math.min(lowLinks.get(file)!, indices.get(target)!),
        );
      }
    }

    if (lowLinks.get(file) !== indices.get(file)) {
      return;
    }

    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== file);

    const hasSelfEdge =
      component.length === 1 &&
      (graph.edges.get(file) ?? []).some((edge) => edge.target === file);
    if (component.length > 1 || hasSelfEdge) {
      components.push(component.sort());
    }
  }

  for (const file of graph.files) {
    if (!indices.has(file)) {
      connect(file);
    }
  }

  return components.sort((left, right) =>
    sourcePath(left[0]).localeCompare(sourcePath(right[0])),
  );
}

function describeCycle(
  component: readonly string[],
  graph: SourceDependencyGraph,
): string {
  const members = new Set(component);
  const memberLines = component.map((file) => `  - ${sourcePath(file)}`);
  const edgeLines = component.flatMap((file) =>
    (graph.edges.get(file) ?? [])
      .filter((edge) => edge.target && members.has(edge.target))
      .map(
        (edge) =>
          `  - ${sourcePath(file)}:${edge.line}: ${edge.specifier} -> ${sourcePath(edge.target!)}`,
      ),
  );
  return ["cycle members:", ...memberLines, "cycle edges:", ...edgeLines].join(
    "\n",
  );
}

function sourcePath(file: string): string {
  return relative(SRC_ROOT, file).split(sep).join("/");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) {
      return [];
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}
