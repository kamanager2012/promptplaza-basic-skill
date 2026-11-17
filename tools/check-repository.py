#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Check the public repository and optionally smoke-test a nine-file installation.

No credentials, business requests, models, media or third-party dependencies.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import subprocess
import tempfile
from urllib.parse import unquote, urlsplit

INSTALL = frozenset({
    'LICENSE', 'NOTICE', 'README.md', 'SKILL.md', 'THIRD-PARTY.md',
    'PACKAGE.json', 'package.json', 'scripts/plaza-basic.mjs', 'tests/basic.test.mjs',
})
EXTRAS = frozenset({
    '.gitattributes', '.gitignore', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md',
    'docs/usage.md', 'docs/compatibility.md', 'tools/check-repository.py',
    '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml',
    '.github/ISSUE_TEMPLATE/config.yml', '.github/pull_request_template.md',
    '.github/workflows/basic-checks.yml',
})
REPOSITORY = INSTALL | EXTRAS
PUBLIC_BASE = 'https://github.com/kamanager2012/promptplaza-basic-skill/blob/main/'


def require(ok: bool, message: str) -> None:
    if not ok:
        raise ValueError(message)


def read_payload(root: Path) -> dict[str, bytes]:
    require(root.is_dir() and not root.is_symlink(), 'INVALID_ROOT')
    found = {}
    for directory, dirs, names in os.walk(root, followlinks=False):
        # Local fixtures and Git metadata are never package/repository content.
        if Path(directory) == root:
            dirs[:] = [d for d in dirs if d not in {'.git', '.runtime'}]
        for name in dirs + names:
            require(not (Path(directory) / name).is_symlink(), 'SYMLINK')
        for name in names:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            require(relative in REPOSITORY, 'UNEXPECTED_FILE: ' + relative)
            require(path.is_file() and path.stat().st_size <= 64000, 'FILE_BUDGET')
            found[relative] = path.read_bytes()
    return found


def check(payload: dict[str, bytes]) -> dict:
    require(set(payload) == REPOSITORY, 'REPOSITORY_FILE_SET')
    require(sum(map(len, payload.values())) <= 256 * 1024, 'REPOSITORY_BYTE_BUDGET')
    for name, raw in payload.items():
        text = raw.decode('utf-8')
        require('\r' not in text and '\0' not in text, 'TEXT_FORMAT: ' + name)
        require(not re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|'
                              r'ghp_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|'
                              r'AKIA[0-9A-Z]{16}', text), 'SECRET_PATTERN: ' + name)
        if not name.endswith('.md'):
            continue
        # Check local targets, including links written as absolute public URLs.
        for link in re.findall(r'\[[^\]\n]*\]\(([^\s)]+)\)', text):
            if link.startswith(PUBLIC_BASE):
                target = unquote(urlsplit(link).path.split('/blob/main/', 1)[1])
            elif urlsplit(link).scheme or link.startswith('#'):
                continue
            else:
                target = os.path.normpath(str(PurePosixPath(name).parent / unquote(urlsplit(link).path)))
            require(target in payload, 'BROKEN_LOCAL_LINK: ' + name + ' -> ' + target)
    meta = json.loads(payload['PACKAGE.json'])
    npm = json.loads(payload['package.json'])
    require(meta['version'] == npm['version'] and npm['engines']['node'] == '>=22', 'VERSION_CONTRACT')
    require(meta['status'] == 'PUBLIC_BETA' and npm['private'] is True
            and meta['license'] == npm['license'] == 'Apache-2.0', 'DISTRIBUTION_POLICY')
    require(meta['allowed_commands'] == ['search', 'get', 'download', 'capabilities', 'creative', 'usage', 'status', 'login', 'logout']
            and meta.get('same_features_for_all_account_tiers') is True
            and meta.get('features_mode') == 'shared_client_remote_private_core'
            and meta['proprietary_source_files_included'] is False
            and meta['model_execution_by_package'] is False
            and not npm.get('dependencies') and not npm.get('devDependencies'), 'BASIC_BOUNDARY')
    return {'state': 'PASS', 'version': meta['version'], 'repository_files': len(payload),
            'installation_files': len(INSTALL), 'repository_only_files': len(EXTRAS),
            'bytes': sum(map(len, payload.values())), 'local_link_targets': 'PASS',
            'snapshot_sha256': hashlib.sha256(b''.join(
                n.encode() + b'\0' + hashlib.sha256(payload[n]).digest()
                for n in sorted(payload))).hexdigest()}


def memory_guard() -> None:
    info = Path('/proc/meminfo')
    if info.exists():
        match = re.search(r'^MemAvailable:\s+(\d+) kB', info.read_text(), re.M)
        require(bool(match) and int(match[1]) >= 1536 * 1024, 'RESOURCE_GUARD_MEMAVAILABLE_1536_MIB')


def smoke(root: Path, payload: dict[str, bytes]) -> dict:
    memory_guard()
    base = root / '.runtime'
    require(not base.is_symlink(), 'RUNTIME_SYMLINK')
    base.mkdir(mode=0o700, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='basic-check-', dir=base) as directory:
        work = Path(directory)
        target = work / 'project/.agents/skills/promptplaza-basic'
        target.mkdir(parents=True)
        for name in INSTALL:
            path = target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload[name])
        for name in ['home', 'tmp']:
            (work / name).mkdir(mode=0o700)
        env = {'PATH': os.environ.get('PATH', os.defpath), 'LANG': 'C.UTF-8',
               'HOME': str(work / 'home'), 'TMPDIR': str(work / 'tmp'),
               'NODE_OPTIONS': '--max-old-space-size=128', 'UV_THREADPOOL_SIZE': '2',
               'HTTP_PROXY': 'http://127.0.0.1:9', 'HTTPS_PROXY': 'http://127.0.0.1:9',
               'ALL_PROXY': 'http://127.0.0.1:9', 'NO_PROXY': ''}

        def run(args: list[str]) -> bytes:
            memory_guard()
            child = subprocess.Popen(args, cwd=target, env=env, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            try:
                stdout, stderr = child.communicate(timeout=45)
            except BaseException:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.communicate(timeout=2)
                raise
            require(len(stdout) + len(stderr) <= 65536, 'OUTPUT_BUDGET')
            require(child.returncode == 0, 'CHILD_FAILED: ' + (stdout + stderr)[-1800:].decode('utf-8', 'replace'))
            require(sum(p.stat().st_size for p in work.rglob('*') if p.is_file()) <= 8 * 1024 * 1024,
                    'FIXTURE_BYTE_BUDGET')
            memory_guard()
            return stdout

        run(['node', '--check', 'scripts/plaza-basic.mjs'])
        output = run(['node', '--test-concurrency=1', '--test-timeout=10000', '--test', 'tests/basic.test.mjs'])
        print(output.decode(), end='')
        help_result = json.loads(run(['node', 'scripts/plaza-basic.mjs', 'help']))
        require(help_result['generation_calls'] == 0 and len(help_result['commands']) == 9
                and set(help_result.get('creative_operations', [])) == {
                    'compile', 'revise', 'remix', 'remix-revise',
                    'interview-new', 'interview-next', 'interview-answer',
                    'case-ideas', 'recipe-catalog', 'recipe-compile'}, 'INSTALLED_HELP')
        require(all((target / n).read_bytes() == payload[n] for n in INSTALL), 'INSTALLED_BYTES')
        return {'clean_nine_file_installation': 'PASS', 'client_regressions': 'PASS',
                'help_native_exit': 0, 'business_requests': 0, 'model_media_calls': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--smoke', action='store_true')
    args = parser.parse_args()
    try:
        root = Path(__file__).resolve().parents[1]
        payload = read_payload(root)
        result = check(payload)
        if args.smoke:
            result.update(smoke(root, payload))
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    except Exception as error:
        print(json.dumps({'state': 'FAIL', 'error': str(error)}, ensure_ascii=False))
        raise SystemExit(1)
