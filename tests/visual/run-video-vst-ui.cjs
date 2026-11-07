const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),profile=fs.mkdtempSync(path.join(root,'release-work/video-vst-ui-'));
const env={...process.env,ASTRELIS_VIDEO_VST_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(__dirname,'video-vst-ui-main.cjs')],
  {cwd:root,env,windowsHide:true,stdio:'inherit'});
child.once('exit',(code,signal)=>{console.log('Video VST UI artifacts:',profile);process.exitCode=code||Number(Boolean(signal));});
