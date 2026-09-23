import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

mkdirSync('dist', { recursive: true });
const patch = {
  name: 'isolated-honcho-adapter',
  setup(builder) {
    builder.onLoad({ filter: /vendor\/claude\/.*\.ts$/ }, args => {
      let contents = readFileSync(args.path, 'utf8');
      // All upstream state lives inside this conversation's selected directory.
      contents = contents.replaceAll('join(homedir(), ".honcho")', 'process.env.HONCHO_CONFIG_DIR!');
      contents = contents.replaceAll('join(homedir(), ".honcho",', 'join(process.env.HONCHO_CONFIG_DIR!,');
      if (args.path.endsWith('/src/config.ts')) {
        if (!contents.includes('export function getSessionName(cwd: string, instanceId?: string): string {')) throw new Error('Unsupported Claude source: session resolver');
        contents = contents.replace('export function getSessionName(cwd: string, instanceId?: string): string {', 'export function getSessionName(cwd: string, instanceId?: string): string {\n  if (!process.env.HONCHO_PINNED_SESSION) throw new Error("Missing pinned session");\n  return process.env.HONCHO_PINNED_SESSION;\n');
        contents = contents.replace('maxRetries: 1,', 'maxRetries: 0,').replace('timeout: 120000,', 'timeout: 8000,');
      }
      if (args.path.endsWith('/src/hooks/session-start.ts')) {
        contents=contents.replace('process.exit(0);\n  }\n}', 'process.exit(1);\n  }\n}');
        contents=contents.replace('const successCount = asyncResults.filter(r => r.success).length;', 'const successCount = asyncResults.filter(r => r.success).length;\n    if (successCount !== asyncResults.length) throw new Error("Honcho recall incomplete");');
      }
      if (args.path.endsWith('/src/hooks/user-prompt.ts')) {
        contents=contents.replace('const userCtx: { context:', 'if (wantUserContext && !userCtxResult?.context) throw new Error("Honcho recall incomplete");\n  const userCtx: { context:');
      }
      contents=contents.replaceAll('mcp__plugin_honcho_honcho__','mcp__honcho__');
      return { contents, loader: 'ts', resolveDir: resolve(args.path, '..') };
    });
  }
};
for (const hook of ['session-start', 'user-prompt']) {
  await build({ entryPoints: [`vendor/claude/hooks/${hook}.ts`], outfile: `dist/claude-${hook}.mjs`, platform: 'node', target:'node24', format:'esm', bundle:true, packages:'external', plugins:[patch] });
}
await build({entryPoints:['vendor/claude/src/redact.ts'],outfile:'dist/redact.mjs',platform:'node',target:'node24',format:'esm',bundle:true});
writeFileSync('dist/build.json', JSON.stringify({claude:'0.3.2',patches:['per-conversation state','pinned remote session','no SDK retries']},null,2)+'\n');
