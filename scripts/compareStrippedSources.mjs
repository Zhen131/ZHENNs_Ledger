// Compares the non-test src/**/*.ts(x) token sequences of two revisions with every comment and blank stripped, so a comment-only change reports no difference.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "typescript";

const WORKTREE = "--worktree";
const args = process.argv.slice(2);
const base = args[0] ?? "main";
const target = args[1] ?? "HEAD";
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

for (const revision of [base, target]) {
  if (revision === WORKTREE) {
    continue;
  }
  const check = spawnSync(
    "git",
    ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (check.status !== 0) {
    console.error(`Not a valid commit: ${revision}`);
    process.exit(2);
  }
}

const baseFiles = readRevision(base);
const targetFiles = readRevision(target);
const paths = [...new Set([...baseFiles.keys(), ...targetFiles.keys()])].sort();
const differences = [];

for (const path of paths) {
  const baseText = baseFiles.get(path);
  const targetText = targetFiles.get(path);
  if (baseText === undefined) {
    differences.push(`${path} added`);
    continue;
  }
  if (targetText === undefined) {
    differences.push(`${path} removed`);
    continue;
  }
  const baseTokens = leafTokens(path, baseText);
  const targetTokens = leafTokens(path, targetText);
  const length = Math.max(baseTokens.length, targetTokens.length);
  for (let index = 0; index < length; index += 1) {
    const before = baseTokens[index];
    const after = targetTokens[index];
    if (
      before === undefined ||
      after === undefined ||
      before.kind !== after.kind ||
      before.text !== after.text
    ) {
      const line = after?.line ?? before?.line ?? 1;
      differences.push(`${path}:${line}`);
      break;
    }
  }
}

if (differences.length > 0) {
  for (const difference of differences) {
    console.log(difference);
  }
  console.log(
    `${differences.length} of ${paths.length} non-test source files differ after stripping comments (${base} -> ${target}).`,
  );
  process.exit(1);
}

console.log(
  `Compared ${paths.length} non-test source files: identical after stripping comments (${base} -> ${target}).`,
);
process.exit(0);

function isComparedPath(path) {
  return (
    path.startsWith("src/") &&
    /\.tsx?$/u.test(path) &&
    !path.includes("/__tests__/")
  );
}

function readRevision(revision) {
  if (revision === WORKTREE) {
    return readWorktree();
  }
  const listed = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", "--name-only", revision, "--", "src"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((path) => path.length > 0 && isComparedPath(path));
  const files = new Map();
  if (listed.length === 0) {
    return files;
  }
  const output = execFileSync("git", ["cat-file", "--batch"], {
    cwd: repoRoot,
    input: listed.map((path) => `${revision}:${path}\n`).join(""),
    maxBuffer: 512 * 1024 * 1024,
  });
  let offset = 0;
  for (const path of listed) {
    const headerEnd = output.indexOf(0x0a, offset);
    const header = output.subarray(offset, headerEnd).toString("utf8");
    const size = Number(header.split(" ")[2]);
    const start = headerEnd + 1;
    files.set(path, output.subarray(start, start + size).toString("utf8"));
    offset = start + size + 1;
  }
  return files;
}

function readWorktree() {
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      const path = relative(repoRoot, absolute).split(sep).join("/");
      if (isComparedPath(path)) {
        files.set(path, readFileSync(absolute, "utf8"));
      }
    }
  };
  visit(join(repoRoot, "src"));
  return files;
}

function leafTokens(path, text) {
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const tokens = [];
  const visit = (node) => {
    if (
      node.kind >= ts.SyntaxKind.FirstJSDocNode &&
      node.kind <= ts.SyntaxKind.LastJSDocNode
    ) {
      return;
    }
    const children = node.getChildren(sourceFile);
    if (children.length > 0) {
      children.forEach(visit);
      return;
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken) {
      return;
    }
    const isJsxText = node.kind === ts.SyntaxKind.JsxText;
    const start = isJsxText ? node.pos : node.getStart(sourceFile);
    if (start >= node.end) {
      return;
    }
    tokens.push({
      kind: node.kind,
      text: isJsxText ? node.text : text.slice(start, node.end),
      line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
    });
  };
  visit(sourceFile);
  return tokens;
}
