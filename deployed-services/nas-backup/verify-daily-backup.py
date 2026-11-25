from pathlib import Path
import hashlib,json,subprocess
root=Path('/volume2/Backup/GrowthIsland')
s=json.loads((root/'last-status.json').read_text()); p=Path(s['backup']); m=json.loads((p/'manifest.json').read_text())
assert s['success'] and m['restore_tested']
for name, item in m['files'].items():
 assert hashlib.sha256((p/name).read_bytes()).hexdigest()==item['sha256'],name
assert (root/'last-error.txt').stat().st_size==0
print(json.dumps({'files_verified':len(m['files']),'database_bytes':(p/'database.dump').stat().st_size,'restore_tested':m['restore_tested'],'photos_included':m['restore_summary']['photos'],'photo_bytes':m['restore_summary']['photo_bytes']}))
