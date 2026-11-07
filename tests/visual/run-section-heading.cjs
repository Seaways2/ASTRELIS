const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
for(const dpi of (process.argv[2]?[Number(process.argv[2])]:[1])){
 const profile=fs.mkdtempSync(path.join(root,'release-work/window-fit-'));
 const env={...process.env,ASTRELIS_FIT_TEST_PROFILE:profile,ASTRELIS_FIT_TEST_DPI:String(dpi)};delete env.ELECTRON_RUN_AS_NODE;
 const result=spawnSync(path.join(root,'node_modules/electron/dist/electron.exe'),['--force-device-scale-factor='+dpi,path.join(__dirname,'section-heading-main.cjs')],{cwd:root,env,windowsHide:true,stdio:'inherit',timeout:70000});
 console.log('Artifacts:',profile);if(result.status!==0){process.exitCode=1;break;}
}
