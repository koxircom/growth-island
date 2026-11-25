#!/usr/bin/env python3
"""Local daily, consistent PostgreSQL backup; isolated restore validation; no deletion."""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess as sp
import sys
import time

ROOT = Path('/volume2/Backup/GrowthIsland')
APP = Path('/volume1/docker/growth-island')
DB = 'growth-island-db-1'
DOCKER = '/usr/local/bin/docker'
MARKER = 'growth-island-daily-backup-v1'
os.umask(0o077)

def run(args, **kw):
    return sp.run(args, check=True, timeout=kw.pop('timeout', 300), **kw)

def out(args):
    return run(args, stdout=sp.PIPE, stderr=sp.PIPE, universal_newlines=True).stdout.strip()

def wait_restore_ready(name, timeout=90):
    # The image's init server is socket-only and stops before the final server.
    # Probe TCP inside the isolated container, never the transient init socket.
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = run([DOCKER, 'exec', name, 'psql', '-X', '-w',
                          '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
                          '-Atc', 'SELECT 1'], stdout=sp.PIPE, stderr=sp.PIPE,
                         timeout=min(5, max(0.01, deadline-time.monotonic())))
            if result.stdout.strip() == b'1':
                return
        except (sp.CalledProcessError, sp.TimeoutExpired):
            pass
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(1, remaining))
    raise RuntimeError('Isolated restore PostgreSQL TCP readiness timed out')

def write_json(path, value):
    tmp = path.with_suffix('.tmp')
    with tmp.open('w') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.flush(); os.fsync(f.fileno())
    tmp.replace(path)

def main():
    # Never silently write a backup to system disk if data volume is absent.
    if not os.path.ismount('/volume2') or not Path('/volume2/Backup').is_dir():
        raise RuntimeError('Backup volume unavailable')
    ROOT.mkdir(mode=0o700, exist_ok=True)
    lock = (ROOT / '.backup.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('A backup is already running; no second job started.'); return
    if shutil.disk_usage(ROOT).free < 1024**3:
        raise RuntimeError('Backup disk has less than 1 GiB free')
    (ROOT / 'daily').mkdir(mode=0o700, exist_ok=True)
    (ROOT / 'archive').mkdir(mode=0o700, exist_ok=True)
    stamp = dt.datetime.utcnow().strftime('%Y%m%dT%H%M%S%fZ')
    work = ROOT / 'daily' / (stamp + '.partial')
    work.mkdir(mode=0o700)
    name = 'growth-island-backup-check-' + stamp.lower()
    created = False
    try:
        image = out([DOCKER, 'inspect', DB, '--format', '{{.Image}}'])
        with (work / 'database.dump').open('wb') as f:
            run([DOCKER, 'exec', DB, 'pg_dump', '-U', 'postgres', '-d', 'growth_island', '-Fc'], stdout=f, stderr=sp.PIPE)
            f.flush(); os.fsync(f.fileno())
        with (work / 'roles-no-passwords.sql').open('wb') as f:
            run([DOCKER, 'exec', DB, 'pg_dumpall', '-U', 'postgres', '--roles-only', '--no-role-passwords'], stdout=f, stderr=sp.PIPE)
        with (work / 'database.dump').open('rb') as f:
            run([DOCKER, 'exec', '-i', DB, 'pg_restore', '--list'], stdin=f, stdout=sp.DEVNULL, stderr=sp.PIPE)
        if (work / 'database.dump').stat().st_size == 0:
            raise RuntimeError('Empty backup')
        # A disposable, non-networked PostgreSQL instance: no published ports,
        # no production mounts, no workers, no persistent Docker volumes.
        run([DOCKER, 'run', '-d', '--name', name, '--network', 'none', '--memory', '384m',
             '--cpu-shares', '128', '--shm-size', '64m', '--tmpfs', '/var/lib/postgresql/data:size=256m',
             '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image], stdout=sp.DEVNULL, stderr=sp.PIPE)
        created = True
        wait_restore_ready(name)
        roles = (work / 'roles-no-passwords.sql').read_text()
        roles = re.sub(r'^CREATE ROLE postgres;\s*$', '', roles, flags=re.M)
        run([DOCKER, 'exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
            input=roles.encode(), stdout=sp.DEVNULL, stderr=sp.PIPE)
        run([DOCKER, 'exec', name, 'createdb', '-h', '127.0.0.1', '-U', 'postgres', 'growth_island_restore'], stdout=sp.DEVNULL, stderr=sp.PIPE)
        with (work / 'database.dump').open('rb') as f:
            run([DOCKER, 'exec', '-i', name, 'pg_restore', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'growth_island_restore', '--exit-on-error'],
                stdin=f, stdout=sp.DEVNULL, stderr=sp.PIPE)
        stats_sql = """SELECT json_build_object(
         'children', (SELECT count(*) FROM public.children),
         'habits', (SELECT count(*) FROM public.habits),
         'checkins', (SELECT count(*) FROM public.checkins),
         'photos', (SELECT count(*) FROM private.child_photos),
         'photo_bytes', (SELECT coalesce(sum(octet_length(image)),0) FROM private.child_photos),
         'photo_references_missing', (SELECT count(*) FROM public.children c WHERE photo_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.child_photos p WHERE p.id=c.photo_id)),
         'rls_tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND c.relrowsecurity));"""
        stats = json.loads(out([DOCKER, 'exec', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'growth_island_restore', '-Atc', stats_sql]))
        if stats['photo_references_missing']:
            raise RuntimeError('Restored photo reference validation failed')
        for fn in ['compose.yaml', 'compose.override.yaml', 'DEPLOYED_RELEASE.json']:
            p = APP / fn
            if p.is_file(): shutil.copyfile(p, work / fn)
        if (ROOT / 'RESTORE.md').exists(): shutil.copyfile(ROOT / 'RESTORE.md', work / 'RESTORE.md')
        shutil.copyfile(Path(__file__), work / 'daily-backup.py')
        metadata = {'format': MARKER, 'created_utc': stamp, 'database': 'growth_island',
                    'postgres_image': image, 'restore_tested': True, 'restore_summary': stats,
                    'contains_private_family_data': True, 'contains_child_photos': True,
                    'role_passwords_included': False,
                    'retention': '30 days in daily, older successful backups archived without deletion',
                    'files': {p.name: {'size_bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                              for p in work.iterdir() if p.is_file()}}
        write_json(work / 'manifest.json', metadata)
        final = ROOT / 'daily' / stamp
        work.rename(final)
        # Move only our own successful backups; never delete historical restore points.
        cutoff = dt.datetime.utcnow() - dt.timedelta(days=30)
        for p in (ROOT / 'daily').iterdir():
            if not re.fullmatch(r'\d{8}T\d{12}Z', p.name) or p.is_symlink(): continue
            try:
                old = json.loads((p / 'manifest.json').read_text())
                if old.get('format') == MARKER and old.get('restore_tested') and dt.datetime.strptime(p.name, '%Y%m%dT%H%M%S%fZ') < cutoff:
                    p.rename(ROOT / 'archive' / p.name)
            except (ValueError, OSError):
                pass
        status = {'success': True, 'completed_utc': dt.datetime.utcnow().isoformat()+'Z', 'backup': str(final),
                  'database_bytes': (final/'database.dump').stat().st_size, 'restore_tested': True,
                  'free_bytes': shutil.disk_usage(ROOT).free}
        write_json(ROOT / 'last-status.json', status)
        (ROOT / 'last-error.txt').write_text('')
        print(json.dumps(status))
    except Exception as error:
        status = {'success': False, 'completed_utc': dt.datetime.utcnow().isoformat()+'Z',
                  'partial': str(work), 'error_type': type(error).__name__, 'stage': getattr(error, 'cmd', [])[:5]}
        write_json(ROOT / 'last-status.json', status)
        if isinstance(error, sp.CalledProcessError):
            (ROOT / 'last-error.txt').write_bytes(error.stderr or b'')
        print(json.dumps(status), file=sys.stderr)
        # Do not print captured database or credential output to scheduler logs.
        raise RuntimeError('Backup failed; incomplete .partial directory retained for inspection') from None
    finally:
        if created:
            run([DOCKER, 'rm', '-f', name], stdout=sp.DEVNULL, stderr=sp.PIPE)

if __name__ == '__main__':
    main()
