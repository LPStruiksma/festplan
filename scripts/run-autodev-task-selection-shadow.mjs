import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const autodevRoot = path.resolve(requiredEnv('AUTODEV_EXTERNAL_ROOT'));
const bundlePath = path.resolve(repoRoot, requiredEnv('AUTODEV_STATE_BUNDLE_PATH'));
const intakeReportPath = path.resolve(repoRoot, requiredEnv('AUTODEV_INTAKE_REPORT_PATH'));
const outputPath = path.resolve(repoRoot, process.env.AUTODEV_TASK_SELECTION_SHADOW_OUTPUT ?? 'autodev-shadow/task-selection-shadow.json');

const [bundle, intakeReport, lock] = await Promise.all([
  json(bundlePath),
  json(intakeReportPath),
  json(path.join(repoRoot, '.autodev/autodev.lock.json')),
]);

const { loadProjectAdapter } = await import(pathToFileURL(path.join(autodevRoot, 'src/software/project-adapter.mjs')).href);
const {
  buildTaskSelectionRequest,
  taskSelectionSchema,
} = await import(pathToFileURL(path.join(autodevRoot, 'src/software/task-selection.mjs')).href);

const adapter = await loadProjectAdapter({ repoRoot });

if (adapter.project.id !== 'festplan' || adapter.project.repository !== 'LPStruiksma/festplan') {
  fail('FestPlan tenant identity does not match the live repository.');
}
if (adapter.authority.autonomyMode !== 'observe') fail('Initial Tenant #2 proof must remain observe-only.');
if (lock.authorityEffect !== 'NONE') fail('Shadow task selection requires authorityEffect NONE.');
if (JSON.stringify(lock.capabilities) !== JSON.stringify(['project-intake', 'task-selection'])) {
  fail('Shadow task selection requires exactly project-intake + task-selection capabilities.');
}
if (bundle.repository?.projectId !== adapter.project.id) fail('Project Intake bundle project identity does not match the tenant adapter.');
if (bundle.repository?.commitSha !== intakeReport.project?.checkedOutCommit) fail('Project Intake bundle/report commit identities do not match.');
if (intakeReport.autodev?.commitSha !== lock.distribution.commitSha) fail('Safe intake report does not match the exact tenant AutoDev lock.');
if (intakeReport.autodev?.authorityEffect !== 'NONE') fail('Safe intake report unexpectedly grants authority.');

const requiredPaths = new Set(adapter.state.requiredDocs);
for (const requiredPath of requiredPaths) {
  if (!bundle.sourceIndex.some((source) => source.path === requiredPath)) {
    fail(`Project Intake omitted required FestPlan state source ${requiredPath}.`);
  }
}
if (!bundle.sourceIndex.some((source) => source.path === 'package.json')) {
  fail('Tenant #2 proof must include the application package contract.');
}
if (!bundle.sourceIndex.some((source) => source.path === 'vite.config.js')) {
  fail('Tenant #2 proof must include the PWA/build configuration.');
}

const request = buildTaskSelectionRequest({ adapter, bundle });
const sourceIds = bundle.sourceIndex.map((source) => source.id);
const schema = taskSelectionSchema({ sourceIds });

if (request.project.id !== adapter.project.id) fail('External task-selection request lost project identity.');
if (request.repository.commitSha !== bundle.repository.commitSha) fail('External task-selection request lost exact repository identity.');
if (request.sources.length !== bundle.sources.length || request.sourceIndex.length !== bundle.sourceIndex.length) {
  fail('External task-selection request lost durable-state sources.');
}
if (JSON.stringify(schema.properties.evidenceRefs.items.enum) !== JSON.stringify(sourceIds)) {
  fail('External task-selection schema is not bound to exact durable-state source IDs.');
}

const receipt = {
  schemaVersion: 1,
  status: 'TASK_SELECTION_SHADOW_READY',
  tenant: {
    projectId: adapter.project.id,
    authorityEffect: lock.authorityEffect,
    autonomyMode: adapter.authority.autonomyMode,
  },
  autodev: {
    repository: lock.distribution.repository,
    commitSha: lock.distribution.commitSha,
    version: lock.distribution.version,
    capabilities: [...lock.capabilities],
  },
  project: {
    repository: adapter.project.repository,
    checkedOutCommit: bundle.repository.commitSha,
    requiredStatePaths: [...requiredPaths],
  },
  evidence: {
    sourceCount: bundle.sourceIndex.length,
    totalIncludedCharacters: bundle.repository.totalIncludedCharacters,
    intakeReportSha256: intakeReport.reportSha256,
    stateBundleSha256: intakeReport.evidence.stateBundleSha256,
    sourceIndexSha256: sha256(JSON.stringify(bundle.sourceIndex)),
    taskSelectionRequestSha256: sha256(JSON.stringify(request)),
    taskSelectionSchemaSha256: sha256(JSON.stringify(schema)),
  },
  policy: {
    modelInvoked: false,
    repositoryWriteAuthority: false,
    pullRequestWriteAuthority: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    sourceBodiesPublished: false,
  },
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(`FestPlan external AutoDev task-selection shadow proof ready for ${receipt.project.checkedOutCommit}: ${receipt.evidence.taskSelectionRequestSha256}.`);

function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
function requiredEnv(name) { const value = process.env[name]; if (!value) fail(`${name} is required.`); return value; }
function fail(message) { throw new Error(message); }
