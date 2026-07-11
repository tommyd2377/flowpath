import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const targetedProductionFiles = [
  "src/lib/entry-domains.ts",
  "src/lib/decision-tree.ts",
  "src/lib/flowpath-ai.ts",
  "src/lib/reconciliation.ts",
  "src/lib/situation-routing.ts",
  "src/lib/cognitive-operating-layer.ts",
  ...fs
    .readdirSync(path.resolve(process.cwd(), "src/lib/prompts"))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => `src/lib/prompts/${file}`),
];

const narrowProductionPatterns = [
  ["specific sport patch", /\btennis\b/i],
  ["performance-domain patch", /\bacting\b|\bactor\b|\bimprov\b/i],
  ["screen-specific craft patch", /\bscreenwriting\b|\bscreenplay\b|\bfilmmaking\b|\bfilm\b/i],
  ["specific location patch", /\bBrooklyn\b|\bBed\W*Stuy\b|\bNYC\b|\b11216\b/i],
  ["developer identity patch", /\bTom\b|\bThomas(?:\s+DeVito)?\b|\bDeVito\b/i],
  ["narrow startup patch", /\bindie\W+hacking\b|\bapp\W+(?:idea|startup)s?\b/i],
  [
    "cold-application fixture phrase",
    /\bLinkedIn\b[\s\S]{0,120}\bno interviews\b|\bno interviews\b[\s\S]{0,120}\bLinkedIn\b/i,
  ],
  [
    "software-career special case",
    /\bsoftware\W+developers?\b|\bdevelopers?\W+(?:career|job|path|role)\b|\bcoding\W+(?:career|job|path|role)\b/i,
  ],
  ["private-medium special case", /\bprivate\s+writing\b/i],
] as const;

function sourceForNarrowTermScan(source: string) {
  return source
    .replaceAll("\\b", " ")
    .replaceAll("\\s", " ")
    .replace(/\bacting on the recommendation\b/gi, "")
    .replace(/\bnot acting or avoiding\b/gi, "");
}

test("production scan recognizes terms inside regular-expression literals", () => {
  const source = sourceForNarrowTermScan(
    String.raw`/\btennis\b/; acting on-camera; /\bbed[-\s]?stuy\b/; /\bapp\s+startup\b/;`,
  );
  const labels = narrowProductionPatterns
    .filter(([, pattern]) => pattern.test(source))
    .map(([label]) => label);

  assert.deepEqual(labels, [
    "specific sport patch",
    "performance-domain patch",
    "specific location patch",
    "narrow startup patch",
  ]);
});

test("production routing and prompts contain no narrow personal or eval-shaped patches", () => {
  const failures: string[] = [];

  for (const relativePath of targetedProductionFiles) {
    const source = sourceForNarrowTermScan(
      fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8"),
    );
    for (const [label, pattern] of narrowProductionPatterns) {
      if (pattern.test(source)) failures.push(`${relativePath}: ${label}`);
    }
  }

  assert.deepEqual(failures, []);
});

function productionSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "evals") return [];
      return productionSourceFiles(absolute);
    }
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.(?:ts|tsx)$/.test(entry.name)) {
      return [];
    }
    if (entry.name.endsWith("-fixtures.ts")) return [];
    return [absolute];
  });
}

test("production source does not import eval fixtures or mocks", () => {
  const imports = productionSourceFiles(path.resolve(process.cwd(), "src"))
    .filter((file) => /(?:from\s+|import\s*\()["'][^"']*\/evals(?:\/|["'])/.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(process.cwd(), file));

  assert.deepEqual(imports, []);
});
