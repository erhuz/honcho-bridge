#!/usr/bin/env python3
"""Install only owned Honcho settings; preserve unrelated client configuration."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tomlkit

SOURCE = Path(__file__).resolve().parent.parent

def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()

def read_json(path):
    return json.loads(path.read_text()) if path.exists() else {}

def registry(home, node, config_path):
    if not config_path.exists():
        raise ValueError('Configuration missing; copy config/profiles.example.json and configure your destinations first')
    data = read_json(config_path)
    data.setdefault('captureFrom', datetime.datetime.now(datetime.timezone.utc).isoformat())
    # Use the runtime validator so installation and hooks resolve paths identically.
    script = "import {validateRegistry} from './src/config.mjs'; import {readFileSync} from 'node:fs'; console.log(JSON.stringify(validateRegistry(JSON.parse(readFileSync(0,'utf8')),process.argv[1],process.argv[2])));"
    result = subprocess.run([node, '--input-type=module', '-e', script, str(config_path), str(home)],
                            input=json.dumps(data), capture_output=True, text=True, cwd=SOURCE)
    if result.returncode:
        raise ValueError('Invalid bridge configuration: ' + result.stderr)
    return json.loads(result.stdout)


def owned(command, home, config_path):
    try:
        parts = shlex.split(command)
        if '--config' in parts and parts[parts.index('--config') + 1] == str(config_path):
            if any(p.endswith('/src/hook.mjs') for p in parts):
                return True
    except (ValueError, IndexError):
        pass
    return any(value in command for value in [str(home / '.config/honcho/codex.py'),
        str(home / '.codex/honcho/codex-honcho.mjs'), str(SOURCE / 'src/hook.mjs'),
        'codex-honcho ', 'honcho-integration/src/hook.mjs'])

def hooks(current, command, home, config_path, codex=False):
    result = {}
    for event, groups in current.items():
        kept = []
        for group in groups:
            remaining = [h for h in group.get('hooks', []) if not owned(h.get('command', ''), home, config_path)]
            if remaining:
                kept.append({**group, 'hooks': remaining})
        if kept:
            result[event] = kept
    if codex:
        # Keep event ordering while invoking the discovered Node executable directly.
        definitions = [('SessionStart', 'recall', 30, 'startup|resume|clear|compact'),
                       ('UserPromptSubmit', 'prompt', 20, None),
                       ('PostToolUse', 'observe', 10, '*'),
                       ('Stop', 'writeback', 30, None),
                       ('PreCompact', 'writeback', 30, 'manual|auto')]
        for event, verb, timeout, matcher in definitions:
            hook = {'type': 'command', 'command': command + ' ' + verb, 'timeout': timeout}
            if event == 'SessionStart':
                hook['statusMessage'] = 'honcho'
            group = {'hooks': [hook]}
            if matcher:
                group['matcher'] = matcher
            result.setdefault(event, []).insert(0, group)
    else:
        for event in ['SessionStart', 'UserPromptSubmit', 'Stop', 'PreCompact']:
            result.setdefault(event, []).append({'hooks': [{'type': 'command', 'command': command, 'timeout': 60}]})
    return result

def desired(home, node, config_path):
    result = {}
    data = registry(home, node, config_path)
    result[config_path] = encoded(data)
    locations = data.get('installation', {})
    codex_home = Path(locations.get('codexHome', home / '.codex'))
    claude_home = Path(locations.get('claudeHome', home / '.claude'))
    claude_config = Path(locations.get('claudeConfigFile', home / '.claude.json'))
    legacy_settings = data.get('legacy', {})
    runtime_args = ['--config', str(config_path)]
    config = codex_home / 'config.toml'
    doc = tomlkit.parse(config.read_text() if config.exists() else '')
    features = doc.setdefault('features', {})
    features['memories'] = False
    features['hooks'] = True
    server = doc.setdefault('mcp_servers', {}).setdefault('honcho', {})
    for key in ['url', 'http_headers_helper', 'http_headers', 'env_http_headers', 'bearer_token_env_var', 'env', 'cwd']:
        server.pop(key, None)
    server.update(command=node, args=[str(SOURCE / 'src/bridge.mjs'), '--client', 'codex', *runtime_args], enabled=True, tool_timeout_sec=150)
    result[config] = tomlkit.dumps(doc).replace('# >>> codex-honcho >>>\n', '').replace('# <<< codex-honcho <<<\n', '').encode()
    command = shlex.join([node, str(SOURCE / 'src/hook.mjs'), *runtime_args])
    codex_hooks = codex_home / 'hooks.json'
    data = read_json(codex_hooks)
    data['hooks'] = hooks(data.get('hooks', {}), command + ' --client codex', home, config_path, codex=True)
    result[codex_hooks] = encoded(data)
    settings = claude_home / 'settings.json'
    data = read_json(settings)
    data.setdefault('enabledPlugins', {})['honcho@honcho'] = False
    data['hooks'] = hooks(data.get('hooks', {}), command + ' --client claude', home, config_path)
    result[settings] = encoded(data)
    claude = claude_config
    data = read_json(claude)
    data.setdefault('mcpServers', {})['honcho'] = dict(type='stdio', command=node, args=[str(SOURCE / 'src/bridge.mjs'), '--client', 'claude', *runtime_args], timeout=150000)
    # Claude rewrites this file during ordinary use. Formatting alone is not an
    # installation change and must not cause a backup or replace unrelated state.
    result[claude] = claude.read_bytes() if claude.exists() and read_json(claude) == data else encoded(data)
    skill = (SOURCE / 'skills/honcho-memory/SKILL.md').read_bytes()
    for client_home in [codex_home, claude_home]:
        result[client_home / 'skills/honcho-memory/SKILL.md'] = skill
    # Already-running old Codex hooks are redirected; the old HTTP MCP fails closed.
    compat = '#!/usr/bin/env python3\nimport os,sys\n'
    compat += 'if len(sys.argv)>1 and sys.argv[1]=="headers":\n    sys.stderr.write("Honcho bridge installed; restart this Codex client\\n");sys.exit(1)\n'
    compat += 'os.execv(' + repr(node) + ', ' + repr([node, str(SOURCE / 'src/hook.mjs'), '--client', 'codex', *runtime_args]) + ' + sys.argv[1:])\n'
    if (home / '.config/honcho/codex.py').exists():
        result[home / '.config/honcho/codex.py'] = compat.encode()
    # Stop loaded legacy Claude hooks, too. Its new isolated adapter gets its own enabled config.
    for legacy in map(Path, legacy_settings.get('disableConfigs', [])):
        if legacy.exists():
            data = read_json(legacy)
            data['enabled'] = False
            for host in data.get('hosts', {}).values():
                host['enabled'] = False
            result[legacy] = encoded(data)
    for path in map(Path, legacy_settings.get('miseFiles', [])):
        if path.exists():
            data = tomlkit.parse(path.read_text())
            entry = data.get('env', {}).get('_', {})
            if entry.get('source') in legacy_settings.get('envSources', []):
                entry.pop('source')
                result[path] = tomlkit.dumps(data).encode()
    return result

def atomic(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.honcho-tmp')
    temp.write_bytes(data)
    temp.chmod(mode)
    temp.replace(path)

def install(home, node, apply, config_path):
    changes = [(p, b) for p, b in desired(home, node, config_path).items() if not p.exists() or p.read_bytes() != b]
    if not apply or not changes:
        return dict(changed=[str(p) for p, _ in changes], applied=False)
    backup = home / '.config/honcho/backups' / ('bridge-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(parents=True, mode=0o700)
    entries = []
    for index, (path, data) in enumerate(changes):
        original = backup / str(index)
        existed = path.exists()
        if existed:
            atomic(original, path.read_bytes())
        entries.append(dict(path=str(path), backup=str(original) if existed else None,
                            mode=(path.stat().st_mode & 0o777) if existed else 0o600,
                            installed_sha256=hashlib.sha256(data).hexdigest()))
    atomic(backup / 'manifest.json', encoded(entries))
    for (path, data), entry in zip(changes, entries):
        atomic(path, data, entry['mode'])
    return dict(changed=[str(p) for p, _ in changes], applied=True, backup=str(backup))

def rollback(backup):
    entries = read_json(backup / 'manifest.json')
    for entry in entries:
        path = Path(entry['path'])
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != entry['installed_sha256']:
            raise RuntimeError('Rollback refused: file changed after installation: ' + str(path))
    for entry in entries:
        path = Path(entry['path'])
        if entry['backup']:
            atomic(path, Path(entry['backup']).read_bytes(), entry['mode'])
        else:
            path.unlink()
    return dict(restored=len(entries))

if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', type=Path, default=Path.home())
    parser.add_argument('--node', help='Node executable; defaults to discovery through PATH')
    parser.add_argument('--config', type=Path, help='Registry JSON; defaults to HOME/.config/honcho/profiles.json')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    if args.rollback:
        result = rollback(args.rollback.expanduser().resolve())
    else:
        executable = shutil.which(args.node or 'node')
        if not executable:
            parser.error('Node executable not found; install Node 24+ or pass --node PATH')
        home = args.home.expanduser().resolve()
        config_path = (args.config or home / '.config/honcho/profiles.json').expanduser().resolve()
        result = install(home, str(Path(executable).resolve()), args.apply, config_path)
    print(json.dumps(result, indent=2))
