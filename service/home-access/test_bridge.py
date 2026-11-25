import unittest
import socket
import tempfile
import threading
from pathlib import Path
from bridge import Router, Dlna, UnixServer, open_both

class Driver:
 def __init__(self, value, after=None): self.value=value; self.after=after; self.writes=0
 def read(self): return self.value
 def open(self): self.writes+=1; self.value=self.after

class BridgeTests(unittest.TestCase):
 def test_idempotent_and_partial(self):
  router=Driver(True); dlna=Driver(False,True)
  self.assertEqual(open_both(router,dlna),{'network':'open','dlna':'open'})
  self.assertEqual((router.writes,dlna.writes),(0,1))
 def test_unknown_never_writes_and_false_readback_not_success(self):
  router=Driver(None);dlna=Driver(False,None)
  self.assertEqual(open_both(router,dlna),{'network':'unknown','dlna':'unknown'})
  self.assertEqual((router.writes,dlna.writes),(0,1))
 def test_unix_http_bridge_accepts_only_fixed_open_operation(self):
  with tempfile.TemporaryDirectory() as tmp:
   router=Driver(True);dlna=Driver(False,True);server=UnixServer(str(Path(tmp)/'access.sock'),router,dlna)
   worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
   try:
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
     client.connect(str(Path(tmp)/'access.sock'));client.sendall(b'POST /open HTTP/1.0\r\nContent-Length: 2\r\n\r\n{}')
     response=b''
     while True:
      chunk=client.recv(4096)
      if not chunk:break
      response+=chunk
    self.assertIn(b'200 OK',response);self.assertIn(b'"network":"open"',response);self.assertIn(b'"dlna":"open"',response)
    self.assertEqual((router.writes,dlna.writes),(0,1))
   finally:server.shutdown();server.server_close();worker.join()
 def test_router_fixed_destination_and_actions(self):
  calls=[]
  def runner(argv,timeout): calls.append(argv);return (0,'open')
  router=Router('/key','/known',runner);self.assertTrue(router.read())
  self.assertEqual(calls[0][-2:],['admin@192.168.50.1','status'])
  with self.assertRaises(ValueError):router.call('status;reboot')
 def test_dlna_only_starts_named_package_and_unknown_is_safe(self):
  calls=[]
  def runner(argv,timeout):calls.append(argv);return (0,'{"status":"running"}')
  dlna=Dlna(runner);self.assertTrue(dlna.read());dlna.open()
  self.assertEqual(calls[1],['/usr/syno/bin/synopkg','start','MediaServer'])
  self.assertIsNone(Dlna(lambda *args:(1,'bad json')).read())

if __name__ == '__main__':unittest.main()
