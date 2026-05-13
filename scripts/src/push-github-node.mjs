#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const GH_TOKEN = process.env.GH_TOKEN;
if (!GH_TOKEN) { console.log('[push] GH_TOKEN not set — skipping'); process.exit(0); }

const REMOTE = 'https://hydra-bot@github.com/Blxckxyz101/hydra-consultoria.git';
const cwd = new URL('../../', import.meta.url).pathname;

const askpass = join(tmpdir(), `gh-askpass-${Date.now()}.sh`);
writeFileSync(askpass, `#!/bin/sh\nprintf '%s' '${GH_TOKEN.replace(/'/g, "'\\''")}'`, { mode: 0o700 });

const env = { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0' };

function run(args) {
  try {
    const out = execFileSync(args[0], args.slice(1), { cwd, encoding: 'utf8', env, stdio: ['pipe','pipe','pipe'] });
    return { ok: true, out: out.trim() };
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').replace(GH_TOKEN, '***').trim();
    return { ok: false, err: msg };
  }
}

// Clear stale lock if present
const lockPath = join(cwd, '.git/refs/remotes/github/main.lock');
if (existsSync(lockPath)) { try { unlinkSync(lockPath); } catch {} }

console.log('[push] Fetching remote state...');
const fetch = run(['git', 'fetch', REMOTE, 'refs/heads/main:refs/remotes/github/main']);
if (!fetch.ok) { console.error('[push] Fetch failed:', fetch.err); unlinkSync(askpass); process.exit(1); }
console.log('[push] Fetch OK');

const sha = run(['git', 'rev-parse', 'HEAD']);
console.log('[push] Local SHA:', sha.out);

console.log('[push] Pushing to GitHub...');
const push = run(['git', 'push', REMOTE, 'HEAD:main', '--force-with-lease=refs/heads/main:refs/remotes/github/main']);
if (!push.ok) { console.error('[push] Push failed:', push.err); unlinkSync(askpass); process.exit(1); }
console.log('[push] Done!', push.out);
unlinkSync(askpass);
