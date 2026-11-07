const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),profile=fs.mkdtempSync(path.join(root,'release-work/background-match-'));
const env={...process.env,ASTRELIS_MEDIA_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(__dirname,'background-match-main.cjs')],{cwd:root,env,windowsHide:true,stdio:'inherit'});
child.on('exit',code=>{console.log('Artifacts:',profile);process.exitCode=code??1;});
