const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const base=path.resolve(__dirname,'../../src/i18n');
const localeNames=['zh-CN','en-US','ja-JP'];
const cache={};
function load(name) {
  if(cache[name])return cache[name];
  let source=fs.readFileSync(path.join(base,name+'.ts'),'utf8');
  if(name==='index')source+='\nexport { messages };';
  const output={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports:output.exports,module:output,
    require: id=>id==='react'?{}:load(id.replace('./','')),
    localStorage:{getItem:()=>null,setItem(){}},navigator:{language:'zh-CN'},document:{documentElement:{}},window:{addEventListener(){}}
  });
  return cache[name]=output.exports;
}
const messages=load('index').messages;
test('English and Japanese cover every Chinese key without empty values or mismatched placeholders',()=>{
  const keys=Object.keys(messages['zh-CN']).sort();
  const placeholders=s=>(s.match(/\{[a-zA-Z]\w*\}/g)||[]).sort();
  for(const locale of localeNames.slice(1)) {
    assert.deepEqual(Object.keys(messages[locale]).sort(),keys,locale);
    for(const key of keys) {
      assert.ok(messages[locale][key].trim(),locale+': '+key);
      assert.deepEqual(placeholders(messages[locale][key]),placeholders(messages['zh-CN'][key]),locale+': '+key);
    }
  }
  console.log('Reviewed dictionary keys per language:',keys.length);
});
test('locale source objects do not silently override duplicate keys',()=>{
  for(const file of ['index','systemSettings','currentFeatures','video','directOutput','mediaLibrary']) {
    const sf=ts.createSourceFile(file,fs.readFileSync(path.join(base,file+'.ts'),'utf8'),ts.ScriptTarget.Latest,true);
    function visit(n) {
      if(ts.isObjectLiteralExpression(n)) {
        const seen=new Set();
        for(const p of n.properties)if(ts.isPropertyAssignment(p)) {
          const key=p.name.text;
          assert.ok(!seen.has(key),file+': duplicate '+key);seen.add(key);
        }
      }
      ts.forEachChild(n,visit);
    }visit(sf);
  }
});
test('Japanese sidebar labels stay short while page headings retain full names',()=>{
  for(const [key,text] of Object.entries(messages['ja-JP']))if(key.startsWith('nav.'))assert.ok([...text].length<=6,key);
  assert.equal(messages['ja-JP']['nav.devices'],'音声出力');
  assert.equal(messages['ja-JP']['page.devices'],'オーディオデバイス');
});
test('invalid persisted language falls back to the system language without crashing',()=>{
  const source=fs.readFileSync(path.join(base,'index.ts'),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  for(const stored of ['invalid','en','null','',null]) {
    const exports={},writes=[];
    vm.runInNewContext(code,{
      exports,require:id=>id==='react'?{}:load(id.replace('./','')),
      localStorage:{getItem:()=>stored,setItem:(key,value)=>writes.push(value)},
      navigator:{language:'ja-JP'},document:{documentElement:{}},window:{addEventListener(){}}
    });
    assert.equal(exports.getLanguage(),'system');
    assert.equal(exports.translate('nav.nowPlaying'),'再生中');
    exports.setLanguage('unsupported');
    assert.equal(writes[0],'system');
  }
});

 test('localized application names retain the fixed English product identity',()=>{
 const {applicationName}=load('index');
 assert.equal(applicationName('zh-CN'),'星律');
 assert.equal(applicationName('en-US'),'ASTRELIS');
 assert.equal(applicationName('ja-JP'),'アストレリス');
 });

test('new media controls use dictionary text rather than hard-coded JSX labels',()=>{
  for(const file of ['LibraryApiSettings','LibraryBatchMatch','LibraryFilmMatch','LibraryMusicMatch','LibraryMatchDialog','MatchTaskDock','LibraryArtworkDialog','useFolderProtection','VideoView','VideoPanel','VideoChannelStrip']) {
    const source=fs.readFileSync(path.join(base,'../components',file+'.tsx'),'utf8');
    const sf=ts.createSourceFile(file+'.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function visit(node) {
      if(ts.isJsxText(node) || (ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent))) {
        assert.ok(!/[\u4e00-\u9fff]/.test(node.text),file+': untranslated label '+node.text);
      }
      if(ts.isCallExpression(node) && node.expression.getText(sf)==='t' && ts.isStringLiteral(node.arguments[0])) {
        assert.ok(messages['zh-CN'][node.arguments[0].text],file+': missing key '+node.arguments[0].text);
      }
      ts.forEachChild(node,visit);
    }
    visit(sf);
  }
});
test('media parameters and IPC errors follow the currently selected language',()=>{
  const {setLanguage,translate,translateMessage}=load('index');
  try {
    for(const [locale,start,error] of [['zh-CN','开始 / 继续（3）','密码不正确'],['en-US','Start / resume (3)','Incorrect password'],['ja-JP','開始・再開（3）','パスワードが違います']]) {
      setLanguage(locale);
      assert.equal(translate('media.batchStart',{count:3}),start);
      assert.equal(translateMessage('密码不正确'),error);
      assert.equal(translateMessage('media.passwordWrong'),error);
      assert.ok(translateMessage('TMDB 请求失败（503）').includes('503'));
      assert.equal(translateMessage('Unknown device 123'),'Unknown device 123');
      assert.equal(translate('media.candidates',{title:'$& {name}'}).includes('$& {name}'),true);
    }
    assert.ok(messages['ja-JP']['common.importFiles'].length<=4);
  } finally {setLanguage('zh-CN');}
});
