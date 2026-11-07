const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),profile=fs.mkdtempSync(path.join(root,'release-work/video-ui-'));
const env={...process.env,ASTRELIS_VIDEO_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(__dirname,'video-ui-main.cjs')],{cwd:root,env,windowsHide:true,stdio:'inherit'});
child.on('error',error=>{console.error(error);process.exitCode=1});
child.on('exit',code=>{console.log('Artifacts:',profile);process.exitCode=code??1;});
