#!/usr/bin/env python3
"""Install/remove the user's explicitly requested per-login YourTube service."""
import os, pathlib, plistlib, shutil, subprocess, sys
root=pathlib.Path(__file__).resolve().parents[1]
label='com.max.yourtube.live'
plist=pathlib.Path.home()/'Library'/'LaunchAgents'/f'{label}.plist'
node=shutil.which('node') or '/usr/local/bin/node'
codex=shutil.which('codex') or '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
domain=f'gui/{os.getuid()}'
if len(sys.argv)!=2 or sys.argv[1] not in ('install','remove'):
    raise SystemExit('Usage: python3 scripts/service.py install|remove')
if sys.argv[1]=='remove':
    subprocess.run(['launchctl','bootout',f'{domain}/{label}'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if plist.exists():
        existing=plistlib.loads(plist.read_bytes())
        if existing.get('Label')!=label or str(root/'server.js') not in existing.get('ProgramArguments',[]):
            raise SystemExit('Refusing to remove an unrelated LaunchAgent.')
        plist.unlink()
    print('YourTube LaunchAgent removed.')
else:
    if plist.exists():
        existing=plistlib.loads(plist.read_bytes())
        if existing.get('Label')!=label or str(root/'server.js') not in existing.get('ProgramArguments',[]):
            raise SystemExit('Refusing to overwrite an unrelated LaunchAgent.')
        subprocess.run(['launchctl','bootout',f'{domain}/{label}'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if not pathlib.Path(node).is_file() or not pathlib.Path(codex).is_file():
        raise SystemExit('Node or Codex CLI was not found.')
    plist.parent.mkdir(parents=True,exist_ok=True)
    config={'Label':label,'ProgramArguments':[node,str(root/'server.js')], 'WorkingDirectory':str(pathlib.Path.home()), 'RunAtLoad':True,'KeepAlive':True,'ProcessType':'Background', 'EnvironmentVariables':{'YOURTUBE_CODEX':codex,'PATH':'/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}, 'StandardOutPath':'/dev/null','StandardErrorPath':'/dev/null'}
    plist.write_bytes(plistlib.dumps(config));plist.chmod(0o600)
    subprocess.run(['launchctl','bootstrap',domain,str(plist)],check=True)
    print('YourTube LaunchAgent installed and started.')
