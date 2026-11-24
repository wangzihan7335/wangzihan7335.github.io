/**
 * 本地开发启动器
 * ---------------------------------------------------------------------------
 * 同时启动：
 *   - API 服务
 *   - Vite 开发服务器（HMR）
 *
 * 这里直接使用 child_process 并让子进程继承 stdio，而不是引入 concurrently。
 * 好处是依赖更少、日志不会被吞掉，在受限终端/无管道环境下也能运行。
 * 修改 server/ 后重启一次 npm run dev 即可。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

const children = [];
let stopping = false;

function start(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    windowsHide: false,
  });
  children.push({ label, child });
  child.on('error', (error) => {
    console.error(`[dev] ${label} 启动失败：`, error.message);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.log(`[dev] ${label} 退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`);
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) {
    try {
      if (process.platform === 'win32') {
        child.kill();
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // 忽略已退出的子进程。
    }
  }
  setTimeout(() => process.exit(exitCode), 450).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('\n  拾阶 · 开发模式');
console.log('  ─────────────────────────────');
console.log('  API   http://127.0.0.1:8787');
console.log('  Web   http://127.0.0.1:5173\n');

start('api', NODE, ['--no-warnings', 'server/index.mjs']);
start('web', NODE, [VITE_BIN, '--host', '127.0.0.1'], { FORCE_COLOR: '1' });
