import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'scripts/module-policy.json'), 'utf8'));
const moduleMap = fs.readFileSync(path.join(root, 'MODULES.md'), 'utf8');

const errors = [];
const warnings = [];
const notes = [];
const posix = (value) => value.split(path.sep).join('/');
const relative = (value) => posix(path.relative(root, value));

function filesBelow(directory, accept) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(full, accept));
    else if (accept(full)) result.push(full);
  }
  return result;
}

const sourceFiles = filesBelow(path.join(root, 'src'), (file) => file.endsWith('.ts')).sort();
const testFiles = filesBelow(path.join(root, 'tests'), (file) => file.endsWith('.test.ts')).sort();
const sourcePaths = new Set(sourceFiles.map(relative));
const testNames = testFiles.map((file) => path.basename(file, '.test.ts'));
const testContent = testFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

function lineCount(file) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content) return 0;
  return content.split(/\r?\n/).length - (content.endsWith('\n') ? 1 : 0);
}

function resolveImport(sourceFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(sourceFile), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function featureName(file) {
  const match = relative(file).match(/^src\/features\/([^/]+)\//);
  return match?.[1] || null;
}

function likelyHasTest(sourcePath) {
  const stem = path.basename(sourcePath, '.ts');
  const feature = sourcePath.match(/^src\/features\/([^/]+)\//)?.[1];
  if (feature && testContent.includes(`/features/${feature}/`)) return true;
  const candidates = new Set([stem, feature].filter(Boolean));
  return testNames.some((test) => [...candidates].some((candidate) =>
    test === candidate || test.startsWith(`${candidate}-`) || test.endsWith(`-${candidate}`)
  ));
}

// Inline code spans carry repository paths. Ignore fenced code blocks: matching triple
// backticks as inline spans would swallow the prose and hide real path coverage.
const documentedTokens = new Set([...moduleMap.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map((match) => match[1]));
const documented = (sourcePath) => documentedTokens.has(sourcePath)
  || documentedTokens.has(path.basename(sourcePath));

for (const file of sourceFiles) {
  const sourcePath = relative(file);
  const lines = lineCount(file);
  const baseline = policy.oversizedBaseline[sourcePath];
  if (lines > policy.lineLimit) {
    if (baseline == null) errors.push(`${sourcePath}: ${lines} lines exceeds the ${policy.lineLimit}-line limit`);
    else if (lines > baseline) errors.push(`${sourcePath}: ${lines} lines exceeds its oversized baseline of ${baseline}`);
    else notes.push(`${sourcePath}: ${lines} lines (baseline ${baseline}; existing debt did not grow)`);
  } else if (lines >= policy.warningAt) {
    warnings.push(`${sourcePath}: ${lines} lines is approaching the ${policy.lineLimit}-line limit`);
  }

  if (policy.genericFilenames.includes(path.basename(file))) {
    errors.push(`${sourcePath}: generic module filename is forbidden`);
  }

  const content = fs.readFileSync(file, 'utf8');
  const fromSpecifiers = [...content.matchAll(/^\s*(?:import|export)\s+[^;\n]*?\sfrom\s+['"]([^'"]+)['"]/gm)];
  const sideEffectSpecifiers = [...content.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)];
  const importSpecifiers = [...fromSpecifiers, ...sideEffectSpecifiers].map((match) => match[1]);
  if (importSpecifiers.length >= policy.importWarningAt) {
    warnings.push(`${sourcePath}: ${importSpecifiers.length} imports/exports suggests a broad responsibility`);
  }
  for (const specifier of importSpecifiers) {
    const target = resolveImport(file, specifier);
    if (!target) continue;
    const fromFeature = featureName(file);
    const toFeature = featureName(target);
    if (fromFeature && toFeature && fromFeature !== toFeature) {
      errors.push(`${sourcePath}: feature '${fromFeature}' imports feature '${toFeature}' via ${specifier}`);
    }
  }

  if (!policy.documentationExclusions.includes(sourcePath) && !documented(sourcePath)) {
    warnings.push(`${sourcePath}: not represented in MODULES.md`);
  }
  if (!policy.testHintExclusions.includes(sourcePath) && !likelyHasTest(sourcePath)) {
    warnings.push(`${sourcePath}: no likely feature test found (heuristic only)`);
  }
}

for (const [sourcePath, baseline] of Object.entries(policy.oversizedBaseline)) {
  if (!sourcePaths.has(sourcePath)) {
    errors.push(`module-policy.json: obsolete oversized baseline for missing ${sourcePath}`);
  } else if (lineCount(path.join(root, sourcePath)) <= policy.lineLimit) {
    errors.push(`module-policy.json: remove the obsolete baseline for ${sourcePath}; it is now within the limit`);
  } else if (!Number.isInteger(baseline) || baseline <= policy.lineLimit) {
    errors.push(`module-policy.json: invalid oversized baseline for ${sourcePath}`);
  }
}

const repositoryPathPattern = /^(?:src|tests|public|docs|scripts|relay|\.github)\//;
for (const token of documentedTokens) {
  if (!repositoryPathPattern.test(token) || token.includes('*')) continue;
  if (!fs.existsSync(path.join(root, token))) errors.push(`MODULES.md: referenced path does not exist: ${token}`);
}

function printGroup(label, items) {
  if (!items.length) return;
  console.log(`\n${label} (${items.length})`);
  for (const item of [...new Set(items)].sort()) console.log(`  - ${item}`);
}

console.log(`Workstr module check: ${sourceFiles.length} TypeScript modules, ${testFiles.length} test files`);
printGroup('ERROR', errors);
printGroup('WARN', warnings);
printGroup('NOTE', notes);
console.log(`\nResult: ${errors.length} error(s), ${warnings.length} warning(s)`);
if (errors.length) process.exitCode = 1;
