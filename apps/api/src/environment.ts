import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { environmentSchema } from '@merforge/contracts';
import type { RuntimeOptions } from '@merforge/runtime';
const exec = promisify(execFile);
export async function inspectEnvironment(config: RuntimeOptions['codex']) {
  let available = false;
  if (config) {
    try {
      await exec(config.executable, ['--version'], {
        timeout: 5000,
        maxBuffer: 4096,
      });
      available = true;
    } catch {
      /* no raw stderr or configuration leakage */
    }
  }
  const repositories = await Promise.all(
    Object.entries(config?.repositories ?? {}).map(async ([key, path]) => {
      try {
        const options = {
          timeout: 5000,
          maxBuffer: 1024 * 1024,
          env: {
            PATH: process.env.PATH,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_TERMINAL_PROMPT: '0',
          },
        };
        const head = await exec(
          'git',
          ['-C', path, 'rev-parse', 'HEAD'],
          options,
        );
        const status = await exec(
          'git',
          ['-C', path, 'status', '--porcelain', '--untracked-files=all'],
          options,
        );
        const clean = !status.stdout.trim();
        return {
          key,
          baseCommit: head.stdout.trim(),
          clean,
          message: clean
            ? '可选：当前 HEAD 干净基线'
            : '请先由本机操作者处理未提交文件，再刷新',
        };
      } catch {
        return {
          key,
          baseCommit: null,
          clean: false,
          message: '仓库不可读或尚无提交，请检查本机仓库配置',
        };
      }
    }),
  );
  return environmentSchema.parse({
    codex: {
      configured: !!config,
      available,
      message: available
        ? 'Codex 可执行；认证与实际调用须执行时确认'
        : '请配置 MERFORGE_CODE_CONFIG 并检查 Codex 安装',
    },
    repositories,
    guidance:
      '在项目目录运行 pnpm dev 启动本地服务。代码执行需由本机操作者配置 MERFORGE_CODE_CONFIG（见 README）；配置后重启服务。本界面不写配置、不传递凭证。',
  });
}
