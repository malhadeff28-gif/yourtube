#!/usr/bin/env python3
"""Install the user's explicitly requested per-login YourTube service."""
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
    if not plist.exists():
        print('No YourTube LaunchAgent file found; no service was stopped. A loaded service may still exist.')
    else:
        raise SystemExit('Existing LaunchAgent file retained and no service stopped. Inspect the file and loaded job manually; see the README for removal steps.')
else:
    # A matching file does not prove that launchd's loaded service came from it.
    # Do not stop or replace anything when the shared label/file already exists.
    if plist.exists():
        raise SystemExit('Existing LaunchAgent file retained and no service stopped. Inspect the file and loaded job manually before reinstalling; see the README.')
    if not pathlib.Path(node).is_file() or not pathlib.Path(codex).is_file():
        raise SystemExit('Node or Codex CLI was not found.')
    plist.parent.mkdir(parents=True,exist_ok=True)
    config={'Label':label,'ProgramArguments':[node,str(root/'server.js')], 'WorkingDirectory':str(pathlib.Path.home()), 'RunAtLoad':True,'KeepAlive':True,'ProcessType':'Background', 'EnvironmentVariables':{'YOURTUBE_CODEX':codex,'PATH':'/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}, 'StandardOutPath':'/dev/null','StandardErrorPath':'/dev/null'}
    data=plistlib.dumps(config)
    try:
        fd=os.open(plist,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    except FileExistsError:
        raise SystemExit('Existing LaunchAgent file retained and no service stopped. Inspect it manually before reinstalling; see the README.')
    with os.fdopen(fd,'wb') as output:
        output.write(data)
    try:
        subprocess.run(['launchctl','bootstrap',domain,str(plist)],check=True)
    except (OSError,subprocess.CalledProcessError):
        # Never remove the pathname: another process may have replaced the file.
        raise SystemExit('Could not start the YourTube LaunchAgent. No loaded service was stopped. Any agent file was left untouched and may load at the next login; inspect it manually as described in the README.')
    print('YourTube LaunchAgent installed and started.')
