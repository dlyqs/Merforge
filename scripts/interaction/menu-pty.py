# -*- coding: utf-8 -*-
import os, pty, subprocess, tempfile, time, select, urllib.request, json, socket
from pathlib import Path
root=str(Path(__file__).resolve().parents[2])
with socket.socket() as s:
    s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='merforge-menu-pty-') as d:
    env=dict(os.environ, MERFORGE_DB=d+'/runtime.sqlite', MERFORGE_PORT=str(port), MERFORGE_API_URL='http://127.0.0.1:'+str(port))
    server=subprocess.Popen(['node','--import','tsx','src/main.ts'],cwd=root+'/apps/api',env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    master=slave=None
    child=None
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(env['MERFORGE_API_URL']+'/api/health',timeout=1); break
            except Exception:
                if server.poll() is not None: raise RuntimeError(server.stderr.read().decode())
                time.sleep(.1)
        master,slave=pty.openpty()
        child=subprocess.Popen(['node','--import','tsx','src/main.ts'],cwd=root+'/apps/cli',env=env,stdin=slave,stdout=slave,stderr=slave)
        os.close(slave); slave=None
        steps=[('主菜单','3'),('主菜单','2'),('目标（','PTY human goal'),('选择编号','1'),('阶段名称','First phase'),('进入此阶段','n'),('任务名称','Human task'),('选择编号','2'),('继续添加任务','n'),('继续添加阶段','n'),('确认创建','y'),('主菜单','1'),('选择编号','1'),('选择编号','2'),('选择编号','1'),('选择编号','1'),('本地操作者','local'),('选择编号','4'),('按保存的模式','y'),('选择编号','7'),('选择编号','1'),('选择编号','3'),('人工产物 summary','done'),('选择编号','0'),('主菜单','0')]
        transcript=''; buffer=''; deadline=time.time()+40
        for needle,answer in steps:
            while needle not in buffer or ': ' not in buffer:
                if time.time()>deadline: raise RuntimeError('PTY timeout at '+needle+'\n'+buffer)
                ready,_,_=select.select([master],[],[],.1)
                if ready:
                    chunk=os.read(master,65536).decode('utf-8',errors='replace'); transcript+=chunk; buffer+=chunk
            buffer=''; os.write(master,(answer+'\n').encode()); time.sleep(.04)
        end=time.time()+8
        while child.poll() is None and time.time()<end:
            ready,_,_=select.select([master],[],[],.1)
            if ready:
                try: transcript+=os.read(master,65536).decode('utf-8',errors='replace')
                except OSError: break
        open('/tmp/merforge-pty-transcript.txt','w').write(transcript)
        child.wait(timeout=1)
        assert child.returncode==0
        goals=json.load(urllib.request.urlopen(env['MERFORGE_API_URL']+'/api/goals'))
        goal=json.load(urllib.request.urlopen(env['MERFORGE_API_URL']+'/api/goals/'+goals[0]['id']))
        assert goal['tasks'][0]['status']=='completed',goal
        assert goal['verifications'][0]['verdict']=='PASS'
        print(json.dumps({'pty':'PASS','steps':len(steps),'review':goal['plan']['review'],'task':goal['tasks'][0]['status'],'verdict':goal['verifications'][0]['verdict']}))
        plain=subprocess.run(['node','--import','tsx','src/main.ts'],cwd=root+'/apps/cli',env=env,capture_output=True,timeout=5)
        assert plain.returncode==0 and b'Usage:' in plain.stdout
        menu=subprocess.run(['node','--import','tsx','src/main.ts','menu'],cwd=root+'/apps/cli',env=env,capture_output=True,timeout=5)
        assert menu.returncode==1 and b'TTY' in menu.stderr
        print('non-TTY help and explicit menu rejection: PASS')
    finally:
        open('/tmp/merforge-pty-transcript.txt','w').write(transcript if 'transcript' in locals() else '')
        if child and child.poll() is None: child.kill(); child.wait()
        if master is not None: os.close(master)
        if slave is not None: os.close(slave)
        server.terminate(); server.wait(timeout=5)
