import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Finding = { scope: 'worktree' | 'history'; location: string; line: number; rule: string; fingerprint: string };

const root = resolve(__dirname, '../..');
const baseline = JSON.parse(readFileSync(resolve(__dirname, '../security/secret-scan-baseline.json'), 'utf8')) as {
  acknowledged_history: Array<{ rule: string; fingerprint: string; reason: string; required_action: string }>;
};
const rules = [
  { name: 'OpenAI API key', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Supabase service role', pattern: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?(?!(?:\$\{|<|your_|replace|change|example|test))[A-Za-z0-9_.-]{30,}/i },
  { name: 'JWT secret', pattern: /(?:AUTH_JWT_SECRET|JWT_SECRET)\s*=\s*["']?(?!(?:\$\{|<|your_|replace|change|example|development|test|pravia-test))[^\s"']{16,}/i },
  { name: 'Database password in URL', pattern: /postgres(?:ql)?:\/\/[^:\s]+:["']?(?!(?:\$\{|<|your_|replace|change|example|test))[^@\s]{12,}@/i },
];
const shouldSkip = (path: string) => /(^|\/)(node_modules|dist|coverage)(\/|$)/.test(path) || /package-lock\.json$/.test(path);
const findings: Finding[] = [];
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

const scan = (content: string, scope: Finding['scope'], location: string) => {
  content.split(/\r?\n/).forEach((line, index) => {
    for (const rule of rules) {
      const match = line.match(rule.pattern);
      if (match) findings.push({ scope, location, line: index + 1, rule: rule.name, fingerprint: fingerprint(match[0]) });
    }
  });
};

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(Boolean).filter((file) => !shouldSkip(file));
for (const file of files) {
  try {
    const content = readFileSync(resolve(root, file), 'utf8');
    if (!content.includes('\0')) scan(content, 'worktree', file);
  } catch {
    // Los binarios o archivos que cambian durante la lectura no contienen configuración ejecutable.
  }
}

const history = execFileSync('git', ['log', '-p', '--all', '--format=commit:%H', '--', ':!package-lock.json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 100 * 1024 * 1024,
});
let commit = 'unknown';
let file = 'unknown';
history.split(/\r?\n/).forEach((line, index) => {
  if (line.startsWith('commit:')) commit = line.slice(7, 19);
  else if (line.startsWith('+++ b/')) file = line.slice(6);
  else if ((line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')) {
    for (const rule of rules) {
      const match = line.slice(1).match(rule.pattern);
      if (match) findings.push({ scope: 'history', location: `${commit}:${file}`, line: index + 1, rule: rule.name, fingerprint: fingerprint(match[0]) });
    }
  }
});

const unique = [...new Map(findings.map((finding) => [`${finding.scope}:${finding.location}:${finding.rule}`, finding])).values()];
const isAcknowledged = (finding: Finding) => finding.scope === 'history' && baseline.acknowledged_history.some(
  (item) => item.rule === finding.rule && item.fingerprint === finding.fingerprint,
);
const acknowledged = unique.filter(isAcknowledged);
const unacknowledged = unique.filter((finding) => !isAcknowledged(finding));
console.log(JSON.stringify({
  ok: unacknowledged.length === 0,
  scanned_worktree_files: files.length,
  findings: unacknowledged,
  acknowledged_history: acknowledged.map((finding) => ({
    ...finding,
    ...baseline.acknowledged_history.find((item) => item.rule === finding.rule && item.fingerprint === finding.fingerprint),
  })),
}, null, 2));
if (unacknowledged.length) process.exitCode = 1;
