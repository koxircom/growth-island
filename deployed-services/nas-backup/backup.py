#!/usr/bin/env python3
"""Explicit local-only database backup; never deletes existing backups."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', action='store_true', help='Explicitly create a new backup')
    parser.add_argument('--directory', default='deploy/backups')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    if not args.backup:
        print('No changes made. Run with --backup from the installed project.')
        return
    destination = Path(args.directory).expanduser()
    if not destination.is_absolute():
        destination = root / destination
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    final = destination / ('growth-island-' + stamp + '.dump')
    partial = final.with_suffix('.partial')
    command = ['docker', 'compose', 'exec', '-T', 'db']
    try:
        fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            subprocess.run(command + ['pg_dump', '-U', 'postgres', '-d', 'growth_island', '-Fc'], cwd=root, stdout=stream, check=True)
        if partial.stat().st_size == 0:
            raise RuntimeError('Empty database dump')
        with partial.open('rb') as stream:
            subprocess.run(command + ['pg_restore', '--list'], cwd=root, stdin=stream, stdout=subprocess.DEVNULL, check=True)
        partial.rename(final)
        digest = hashlib.sha256(final.read_bytes()).hexdigest()
        metadata = {'file': final.name, 'sha256': digest, 'size_bytes': final.stat().st_size,
                    'created_utc': stamp, 'archive_catalog_verified': True,
                    'restore_tested': False, 'note': 'Includes private family records. Keep on trusted storage.'}
        report = final.with_suffix('.json')
        fd = os.open(report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(metadata, stream, ensure_ascii=False, indent=2)
        print(json.dumps(metadata, ensure_ascii=False))
    except Exception:
        print('Backup failed. Any .partial file is incomplete and must not be used for recovery.', file=sys.stderr)
        raise

if __name__ == '__main__':
    main()
