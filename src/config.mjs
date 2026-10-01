import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const defaultConfigPath = () => join(homedir(), '.config/honcho/profiles.json');
export const defaultStateDir = () => join(homedir(), '.local/state/honcho-integration');

export function loadRegistry(path = defaultConfigPath()) {
  return validateRegistry(JSON.parse(readFileSync(path, 'utf8')), path);
}

export function validateRegistry(input, path = defaultConfigPath(), home = homedir()) {
  const registry = structuredClone(input);
  const filePath = value => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid configuration path');
    return value === '~' ? home : value.startsWith('~/') ? resolve(home, value.slice(2)) : resolve(dirname(resolve(path)), value);
  };
  if (registry.version !== 1 || !registry.profiles || (registry.defaultProfile !== null && (typeof registry.defaultProfile !== 'string' || !Object.hasOwn(registry.profiles, registry.defaultProfile)))) throw new Error('Unsupported or incomplete Honcho profile registry');
  if (!Number.isFinite(Date.parse(registry.captureFrom))) throw new Error('Invalid capture start timestamp; memory capture refused');
  for (const [id, p] of Object.entries(registry.profiles)) {
    if (!/^[a-z0-9_-]+$/.test(id) || !p.account || !p.workspace || !p.user || !p.credentialFile || !p.endpoint) {
      throw new Error('Incomplete Honcho profile: ' + id);
    }
    const url = new URL(p.endpoint);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('Honcho endpoint must use HTTPS without credentials, query or fragment');
    p.credentialFile = filePath(p.credentialFile);
  }
  if (registry.stateDir !== undefined) registry.stateDir = filePath(registry.stateDir);
  for (const rule of [...(registry.roots ?? []), ...(registry.projects ?? [])]) {
    if (!Object.hasOwn(registry.profiles, rule.profile)) throw new Error('Unknown profile in project rule');
    rule.path = filePath(rule.path);
    if (rule.commonDir) rule.commonDir = filePath(rule.commonDir);
    if (rule.remote) rule.remote = normalizeRemote(rule.remote.includes('://') || rule.remote.includes(':') ? rule.remote : 'https://' + rule.remote);
  }
  for (const pattern of registry.redactPatterns ?? []) new RegExp(pattern);
  for (const [section, fields] of Object.entries({
    installation: ['codexHome', 'claudeHome', 'claudeConfigFile'],
    recovery: ['codexQueueDirs', 'codexTranscriptDirs', 'claudeTranscriptDirs'],
    legacy: ['disableConfigs', 'miseFiles', 'envSources'],
  })) {
    for (const [key, value] of Object.entries(registry[section] ?? {})) {
      if (!fields.includes(key)) throw new Error('Unknown ' + section + ' setting: ' + key);
      if (section !== 'installation' && !Array.isArray(value)) throw new Error(section + ' paths must be arrays');
      registry[section][key] = section === 'installation' ? filePath(value) : value.map(filePath);
    }
  }
  return registry;
}

export function credential(profile) {
  const key = JSON.parse(readFileSync(profile.credentialFile, 'utf8')).apiKey;
  if (typeof key !== 'string' || !key.trim()) throw new Error('Missing credential for account ' + profile.account);
  return key.trim();
}

export function canonical(path) {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}
const contains = (root, path) => path === root || path.startsWith(root + sep);
function git(cwd, args) {
  if(!existsSync(cwd))return null;
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 }).trim(); }
  catch(e) {
    const stderr=String(e.stderr??'');
    if(!e.code && (stderr.includes('not a git repository') || (args[0]==='remote' && stderr.includes('No such remote'))))return null;
    throw new Error('Cannot inspect Git routing evidence; memory destination refused');
  }
}

export function normalizeRemote(value) {
  if (!value) return null;
  const scp = value.match(/^(?:[^/@:]+@)?([^/:]+):([^/].*)$/);
  let host, path;
  if (scp && !value.includes('://')) { [, host, path] = scp; }
  else {
    try { const u = new URL(value); host = u.hostname; path = u.pathname; }
    catch { return null; }
  }
  return `${host.toLowerCase()}/${path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')}`;
}

export function resolveProject(registry, cwd) {
  const path = canonical(cwd);
  const root = git(path, ['rev-parse', '--show-toplevel']);
  const common = root && git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const remote = root && normalizeRemote(git(path, ['remote', 'get-url', 'origin']));
  const hits = [];
  for (const rule of registry.roots ?? []) {
    const base = canonical(rule.path);
    if (contains(base, path) || (common && contains(base, canonical(common)))) hits.push({ profile: rule.profile, reason: 'root' });
  }
  for (const project of registry.projects ?? []) {
    if ((root && canonical(project.path) === canonical(root)) || (common && project.commonDir && canonical(project.commonDir) === canonical(common)) || (remote && project.remote === remote)) {
      hits.push({ profile: project.profile, reason: 'registered repository', project: project.id });
    }
  }
  const profiles = [...new Set(hits.map(h => h.profile))];
  if (profiles.length > 1) throw new Error('Conflicting Honcho project assignments; start only after correcting the registry');
  const profile = profiles[0] ?? registry.defaultProfile;
  if (profile === null) throw new Error('No Honcho workspace assigned to this folder');
  if (!registry.profiles[profile]) throw new Error('Unknown Honcho profile');
  return { profile, cwd: path, recognized: hits.length > 0, project: hits.find(h => h.project)?.project ?? digest(remote || common || root || path).slice(0, 20), reason: hits[0]?.reason ?? 'default profile fallback' };
}

export function identity(profile) {
  return { account: profile.account, endpoint: profile.endpoint.replace(/\/$/, ''), workspace: profile.workspace, user: profile.user };
}

export function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HONCHO_')));
}
