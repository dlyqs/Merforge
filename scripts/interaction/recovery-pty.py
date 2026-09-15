# -*- coding: utf-8 -*-
"""PTY recovery and boundary acceptance; Codex protocol fixture, not real AI."""
import json, os, pty, select, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
root = Path(__file__).resolve().parents[2]
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
work = Path(tempfile.mkdtemp(prefix='merforge-m31-pty-'))
source = work / 'source'; source.mkdir()
def git(*args):
    return subprocess.check_output(['git', '-C', str(source), *args], text=True).strip()
git('init', '-q'); (source / 'sum.mjs').write_text('export const sum=()=>0;')
git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base')
config = dict(executable=str(root/'packages/runtime/src/fixtures/codex.mjs'), repositories=dict(sample=str(source)), managedRoot=str(work/'managed'), artifactRoot=str(work/'evidence'))
(work/'config.json').write_text(json.dumps(config))
env = dict(os.environ, MERFORGE_DB=str(work/'db'), MERFORGE_PORT=str(port), MERFORGE_API_URL=f'http://127.0.0.1:{port}', MERFORGE_CODE_CONFIG=str(work/'config.json'))
server = None
transcript = ''
def api(path, body=None):
    req=urllib.request.Request(env['MERFORGE_API_URL']+path, data=None if body is None else json.dumps(body).encode(), headers={'content-type':'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=15))
def start():
    global server
    server=subprocess.Popen(['node','--import','tsx','src/main.ts'],cwd=root/'apps/api',env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    for _ in range(100):
        try: api('/api/health'); return
        except Exception:
            if server.poll() is not None: raise RuntimeError(server.stderr.read().decode())
            time.sleep(.1)
    raise RuntimeError('server startup timeout')
def stop():
    server.terminate(); server.wait(timeout=10)
def menu(answers):
    global transcript
    master, slave=pty.openpty()
    child=subprocess.Popen(['node','--import','tsx','src/main.ts','menu'],cwd=root/'apps/cli',env=env,stdin=slave,stdout=slave,stderr=slave)
    os.close(slave)
    try:
        buffer=''
        for answer in answers:
            deadline=time.time()+20
            while '（/back 返回）: ' not in buffer:
                if time.time()>deadline: raise RuntimeError('menu timeout '+buffer)
                ready,_,_=select.select([master],[],[],.1)
                if ready:
                    chunk=os.read(master,65536).decode(errors='replace'); transcript+=chunk; buffer+=chunk
            buffer='';os.write(master,(answer+'\n').encode());time.sleep(.03)
        while child.poll() is None:
            ready,_,_=select.select([master],[],[],.1)
            if ready:
                try: transcript+=os.read(master,65536).decode(errors='replace')
                except OSError: break
        child.wait(timeout=3); assert child.returncode==0
    finally:
        if child.poll() is None: child.kill();child.wait()
        os.close(master)
def wait_goal(p, status):
    for _ in range(100):
        g=api('/api/goals/'+p['goalId'])
        if g['tasks'][0]['status']==status:return g
        time.sleep(.1)
    raise RuntimeError(str(g))
try:
    start()
    task=dict(title='Sum',executorId='codex',acceptanceVersion='commands.v1',instructions='CRASH_RETRY',inputs=[],expectedFiles=['sum.mjs'],allowedPaths=['sum.mjs'],forbiddenPaths=[],acceptance=dict(schemaVersion='commands.v1',checks=[dict(id='sum',argv=['node','--input-type=module','-e',"import {sum} from './sum.mjs';if(sum(2,3)!==5)process.exit(1)"],cwd='.',timeoutMs=1000,maxOutputBytes=4096,repeatable=True,independent=True)],protectedFiles=[],allowedOutputs=[],allowEmptyDiff=False),policy=dict(sandbox='workspace-write',network=False,detachedProcesses=False))
    p=api('/api/plans',dict(objective='PTY recovery',revision=1,definition=dict(schemaVersion='plan.v2',workspace=dict(repositoryKey='sample',baseCommit=git('rev-parse','HEAD')),phases=[dict(title='Code',requiresApproval=False,tasks=[task])])))
    menu(['1','1','2','1','1','local','4','y','0','0'])
    g=wait_goal(p,'running')
    for _ in range(100):
        code=api('/api/tasks/'+g['tasks'][0]['id']+'/code')
        path=code['workspace']['path']
        if path and '()=>1' in (Path(path)/'sum.mjs').read_text():break
        time.sleep(.1)
    else: raise RuntimeError('fixture edit timeout')
    menu(['1','1','7','1','2','y','0','0'])
    g=wait_goal(p,'interrupted');stop();start()
    menu(['1','1','7','1','3','2','y','y','y','0','0'])
    g=wait_goal(p,'completed');assert len(g['attempts'])==2
    assert g['verifications'][-1]['verdict']=='PASS'
    recovery=g
    p=api('/api/plans',dict(objective='PTY boundary',revision=1,definition=dict(schemaVersion='plan.v1',phases=[dict(title=str(n),requiresApproval=False,tasks=[dict(title=str(n),executorId='human',acceptanceVersion='summary.v1')]) for n in range(3)])))
    index=str(next(i+1 for i,g in enumerate(api('/api/goals')) if g['id']==p['goalId']))
    menu(['1',index,'2','1','1','local','3','3','1','2','4','y','0','0'])
    for n in ['1','2']:menu(['1',index,'7',n,'3','done','0','0'])
    g=api('/api/goals/'+p['goalId']);assert len(g['attempts'])==2
    stop();start();g=api('/api/goals/'+p['goalId'])
    assert len(g['attempts'])==2 and g['plan']['stopReason']=='boundary_reached' and not g['plan']['authorized']
    menu(['1',index,'5','3','7','3','3','last','0','0'])
    g=api('/api/goals/'+p['goalId']);assert all(t['status']=='completed' for t in g['tasks'])
    (work/'result.json').write_text(json.dumps(dict(pty='PASS',executor='protocol fixture',recovery=recovery,boundary=g),indent=2))
    print('PTY cancellation/restart/retry and three-phase boundary: PASS',work/'result.json')
finally:
    (work/'transcript.txt').write_text(transcript)
    if server and server.poll() is None:stop()
