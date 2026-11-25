import os, subprocess, tempfile, unittest
from pathlib import Path

SOURCE=Path(__file__).with_name('router-tv-control.sh').read_text()
TV='AA:BB:CC:DD:EE:FF'
OTHER='00:11:22:33:44:55'
class RouterScriptTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.bin=self.root/'bin';self.bin.mkdir();self.db=self.root/'db';self.db.mkdir()
  self.target=self.root/'target';self.target.write_text(TV+'\n');self.lock=self.root/'lock';self.log=self.root/'log'
  (self.db/'MULTIFILTER_MAC').write_text(OTHER+'>'+TV)
  (self.db/'MULTIFILTER_ENABLE').write_text('2>1')
  (self.db/'MULTIFILTER_ALL').write_text('1')
  self.exec('nvram', '''#!/bin/sh
case "$1" in
 get) cat "$DB/$2";;
 set) key=${2%%=*}; value=${2#*=}; printf '%s' "$value" > "$DB/$key"; printf 'set\\n' >> "$LOG";;
 commit) printf 'commit\\n' >> "$LOG";;
 *) exit 1;;
esac
''')
  self.exec('service', '#!/bin/sh\nprintf "service:%s\\n" "$1" >> "$LOG"\n')
  self.exec('iptables-save', '#!/bin/sh\nprintf "*filter\\nCOMMIT\\n"\n')
  script=SOURCE.replace('PATH=/usr/sbin:/usr/bin:/sbin:/bin',f'PATH={self.bin}:/usr/bin:/bin').replace('TARGET_FILE=/jffs/.growth-island/tv-mac',f'TARGET_FILE={self.target}').replace('/tmp/growth-island-tv-control.lock',str(self.lock))
  self.script=self.root/'control.sh';self.script.write_text(script);self.env=dict(os.environ,DB=str(self.db),LOG=str(self.log))
 def tearDown(self):self.tmp.cleanup()
 def exec(self,name,text):p=self.bin/name;p.write_text(text);p.chmod(0o755)
 def call(self,action):return subprocess.run(['/bin/sh',str(self.script)],env=dict(self.env,SSH_ORIGINAL_COMMAND=action),capture_output=True,text=True)
 def test_opens_only_target_and_verifies_readback(self):
  r=self.call('open');self.assertEqual((r.returncode,r.stdout.strip()),(0,'open'));self.assertEqual((self.db/'MULTIFILTER_ENABLE').read_text(),'2>0');self.assertEqual(self.log.read_text().splitlines(),['set','commit','service:restart_firewall'])
 def test_open_is_idempotent_and_status_never_writes(self):
  (self.db/'MULTIFILTER_ENABLE').write_text('2>0');r=self.call('open');self.assertEqual((r.returncode,r.stdout.strip()),(0,'open'));self.assertFalse(self.log.exists())
  (self.db/'MULTIFILTER_ENABLE').write_text('2>1');r=self.call('status');self.assertEqual((r.returncode,r.stdout.strip()),(0,'blocked'));self.assertFalse(self.log.exists())
 def test_rejects_ambiguous_or_invalid_data(self):
  (self.db/'MULTIFILTER_MAC').write_text(TV+'>'+TV);r=self.call('open');self.assertNotEqual(r.returncode,0);self.assertFalse(self.log.exists())
  self.assertNotEqual(self.call('open;reboot').returncode,0)
 def test_refuses_to_claim_open_when_drop_rule_remains(self):
  (self.db/'MULTIFILTER_ENABLE').write_text('2>0');self.exec('iptables-save',f'#!/bin/sh\nprintf "-A FORWARD -m mac --mac-source {TV} -j DROP\\n"\n');r=self.call('status');self.assertNotEqual(r.returncode,0);self.assertFalse(self.log.exists())
if __name__=='__main__':unittest.main()
