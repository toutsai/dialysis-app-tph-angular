import { spawn } from 'child_process';

const env = {
  ...process.env,
  ELECTRON_MIRROR:
    process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_CUSTOM_DIR: process.env.ELECTRON_CUSTOM_DIR || 'electron/',
  npm_config_disturl:
    process.env.npm_config_disturl || 'https://npmmirror.com/mirrors/electron/',
};
const args = [
  'electron-rebuild',
  '-f',
  '-w',
  'better-sqlite3',
  '-m',
  'server',
  '--dist-url',
  env.npm_config_disturl,
];

const child = spawn('npx', args, {
  stdio: 'inherit',
  shell: true,
  env,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
