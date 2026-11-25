"""Parent-home-access bridge candidate. No service is installed by this file.

Deployment requires an isolated socket mount, an independently verified
forced-command router key, and target configuration on the router.  Unknown
responses never imply success and are never retried automatically.
"""
import json
import fcntl
import os
import socket
import socketserver
import stat
import subprocess
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler

ROUTER = 'admin@192.168.50.1'
SSH = '/usr/bin/ssh'
SYNOPKG = '/usr/syno/bin/synopkg'


def run(argv, timeout):
    try:
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout, check=False)
        return result.returncode, result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return None, ''


class Router:
    def __init__(self, key, known_hosts, runner=run):
        if not (os.path.isabs(key) and os.path.isabs(known_hosts)):
            raise ValueError('absolute key and trust paths required')
        self.key, self.known_hosts, self.runner = key, known_hosts, runner

    def call(self, action):
        if action not in ('status', 'open'):
            raise ValueError('unsupported action')
        return self.runner([SSH, '-T', '-i', self.key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
                            '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
                            '-o', 'ClearAllForwardings=yes', '-o', 'UserKnownHostsFile='+self.known_hosts,
                            ROUTER, action], 12)

    def read(self):
        code, output = self.call('status')
        if code != 0: return None
        return {'open': True, 'blocked': False}.get(output)

    def open(self):
        self.call('open')


class Dlna:
    def __init__(self, runner=run): self.runner = runner

    def read(self):
        _, output = self.runner([SYNOPKG, 'status', 'MediaServer'], 8)
        try: status = json.loads(output).get('status')
        except (ValueError, AttributeError): return None
        return {'running': True, 'stopped': False}.get(status)

    def open(self):
        self.runner([SYNOPKG, 'start', 'MediaServer'], 25)


def ensure_open(driver):
    try:
        before = driver.read()
        if before is True: return 'open'
        if before is not False: return 'unknown'
        driver.open()
        return 'open' if driver.read() is True else 'unknown'
    except Exception:
        return 'unknown'


def open_both(router, dlna):
    with ThreadPoolExecutor(max_workers=2) as pool:
        network = pool.submit(ensure_open, router)
        media = pool.submit(ensure_open, dlna)
        return {'network': network.result(), 'dlna': media.result()}


class UnixServer(socketserver.UnixStreamServer):
    allow_reuse_address = False
    def __init__(self, path, router, dlna):
        self.router, self.dlna = router, dlna
        super().__init__(path, Handler)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '-1'))
            if self.path != '/open' or length != 2 or self.rfile.read(length) != b'{}':
                self.send_error(400); return
            result = open_both(self.server.router, self.server.dlna)
            body = json.dumps(result, separators=(',', ':')).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        except (OSError, ValueError):
            self.close_connection = True


def main():
    path = os.environ['HOME_ACCESS_SOCKET']
    key, known = os.environ['HOME_ROUTER_KEY'], os.environ['HOME_ROUTER_KNOWN_HOSTS']
    gid = int(os.environ['HOME_ACCESS_SOCKET_GID'])
    if os.geteuid() != 0 or gid <= 0: raise RuntimeError('unsafe service identity')
    if not os.path.isabs(path) or os.path.realpath(path) != path:
        raise RuntimeError('unsafe socket path')
    parent = os.lstat(os.path.dirname(path))
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_mode & 0o022:
        raise RuntimeError('unsafe socket directory')
    for filename, forbidden_mode in ((key, 0o077), (known, 0o022)):
        if not os.path.isabs(filename) or os.path.realpath(filename) != filename:
            raise RuntimeError('unsafe credential path')
        info = os.lstat(filename)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & forbidden_mode:
            raise RuntimeError('unsafe credential permissions')
    # The lock prevents overlapping service instances; only a root-owned stale
    # socket in this protected directory can be removed after an unclean exit.
    lockfd = os.open(path+'.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if os.path.lexists(path):
        info = os.lstat(path)
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0:
            raise RuntimeError('unsafe stale socket')
        probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            probe.settimeout(1)
            if probe.connect_ex(path) == 0: raise RuntimeError('socket already active')
        finally: probe.close()
        os.unlink(path)
    router, dlna = Router(key, known), Dlna()
    with UnixServer(path, router, dlna) as server:
        os.chown(path, 0, gid); os.chmod(path, 0o660)
        original = os.lstat(path)
        try: server.serve_forever()
        finally:
            # Remove only the socket created by this process.
            try:
                info = os.lstat(path)
                if stat.S_ISSOCK(info.st_mode) and (info.st_dev, info.st_ino) == (original.st_dev, original.st_ino):
                    os.unlink(path)
            except FileNotFoundError:
                pass


if __name__ == '__main__': main()
