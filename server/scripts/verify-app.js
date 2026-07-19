require('dotenv').config();

const { spawn } = require('child_process');
const path = require('path');

const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
const serverRoot = path.resolve(__dirname, '..');
const appRoot = path.resolve(serverRoot, '..', '..', 'file-manager-native');
const webExportDir = process.env.APP_VERIFY_WEB_EXPORT_DIR || '/tmp/file-manager-native-web-export-app-verify';

const runCommand = ({ name, command, args, cwd }) => new Promise((resolve, reject) => {
  const startedAt = Date.now();
  console.log(`\n▶ ${name}`);
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR || '0',
    },
  });

  child.on('error', reject);
  child.on('close', (code) => {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (code === 0) {
      console.log(`✓ ${name} (${seconds}s)`);
      resolve();
      return;
    }
    reject(new Error(`${name} failed with exit code ${code}`));
  });
});

const checkHealth = async () => {
  console.log(`\n▶ backend health (${API_BASE_URL}/health)`);
  const response = await fetch(`${API_BASE_URL}/health`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status !== 'ok') {
    throw new Error(`Backend health check failed: ${response.status} ${JSON.stringify(data)}`);
  }
  console.log(`✓ backend health (${data.database?.connected ? 'mysql connected' : 'server only'})`);
};

const npmRun = (script) => ({
  name: script,
  command: 'npm',
  args: ['run', script],
  cwd: serverRoot,
});

const checks = [
  npmRun('verify:department-catalog'),
  npmRun('verify:library-flow'),
  npmRun('verify:mobile-section-flow'),
  npmRun('verify:private-knowledge'),
  npmRun('verify:partner-flow'),
  npmRun('verify:agent-query'),
  {
    name: 'expo web export',
    command: 'npx',
    args: ['expo', 'export', '--platform', 'web', '--output-dir', webExportDir],
    cwd: appRoot,
  },
];

const main = async () => {
  const startedAt = Date.now();
  await checkHealth();
  for (const check of checks) {
    await runCommand(check);
  }
  console.log(JSON.stringify({
    ok: true,
    checked: checks.map((item) => item.name),
    webExportDir,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  }, null, 2));
};

main().catch((error) => {
  console.error(`\n✕ App verification failed: ${error.message}`);
  process.exitCode = 1;
});
