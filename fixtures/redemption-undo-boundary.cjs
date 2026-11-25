// Run from a pinned #36 candidate checkout with its installed dependencies and an offline Chromium.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { parseArgs } = require('node:util');

const { values } = parseArgs({options: {chromium: {type: 'string'}}});
const root = path.resolve(__dirname, '..');
const local = createRequire(path.join(root, 'package.json'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function pinned(file, expected) {
  const bytes = fs.readFileSync(file);
  assert.equal(sha(bytes), expected, 'Unexpected bytes: ' + file);
  return bytes.toString('utf8');
}

// Accepted package/lock pairs for the release-derived candidate and the integrated checkout.
const checkouts = {
  '1.0.3': ['8fd189468992539e4ec84be8c36348d171eb2f97065f1f067fc3a4861d1db0c2','e119e1769cf84a953417ccfb6f727b03a2a16a5f232fc68ed2d1eba510f97265'],
  '1.0.4': ['71889150763512d2d2176ee72ce973366c7cb9e57a743d86a61b5bc223e6b787','a86db10a3d78941f7e88876084f28518d2ba746ab7863d30fa71f355664af752'],
};
const metadata = fs.readFileSync(path.join(root,'package.json'));
const {name,version} = JSON.parse(metadata);
assert.ok(name === 'growth-island' && Object.hasOwn(checkouts,version), 'Expected a supported growth-island checkout');
const [packageHash,lockHash] = checkouts[version];
assert.equal(sha(metadata),packageHash,'Unexpected checkout package.json');
const lock = JSON.parse(pinned(path.join(root,'package-lock.json'),lockHash)).packages;

function packageDir(name) {
  const file = local.resolve(name+'/package.json');
  const meta = JSON.parse(fs.readFileSync(file));
  assert.equal(meta.name,name);
  assert.equal(meta.version,lock['node_modules/'+name].version,'Unexpected installed '+name);
  return path.dirname(file);
}

// SHA-256 of the production inputs, taken from the SHA-512-verified lockfile distributions.
const modules = new Map();
for (const [id,pkg,file,digest] of [
  ['react','react','react.production.js','0b5529981841afa1b58c76ba85c29bb681ff5f07cd8cde6a10b967d3915b8e1c'],
  ['react/jsx-runtime','react','react-jsx-runtime.production.js','1e46f15002696985e80c61d47aaa30dabb03c954270a690f5f7dfbbacfa9002b'],
  ['react-dom','react-dom','react-dom.production.js','7a05d7f7bb2b02aae84018a88d4815a2181eef48d2cb8172d403eaa2b131eefd'],
  ['react-dom/client','react-dom','react-dom-client.production.js','a319b413b7a19ee34422d9a12a8e7afd003c07846716d278ba1a0898e8cb6251'],
  ['scheduler','scheduler','scheduler.production.js','679adff761d31e9426604f80c0e99be44a3e6f4c6834b0218ecf0312a67c171f'],
]) {
  modules.set(id,pinned(path.join(packageDir(pkg),'cjs',file),digest));
}
const compiler = path.join(packageDir('typescript'),'lib/typescript.js');
pinned(compiler,'3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675');
const ts = require(compiler);
const playwrightDir = packageDir('playwright-core');
for (const [file,digest] of [
  ['index.js','a58fb2cec4293e7dcf73c58a179898a4f3986666451a19da4e731fa3af63265b'],
  ['lib/coreBundle.js','4ef8330594818d8f464de939e32bca62b758099e0d0e94a56095406da963f7f1'],
  ['browsers.json','8058cd0e5bf0e9e20511a7052de42c1a89a8b9b36fa1b13da6d08b83d0c7f8b9'],
]) pinned(path.join(playwrightDir,file),digest);
const {chromium} = require(path.join(playwrightDir,'index.js'));

function compile(fileName,source) {
  return ts.transpileModule(source,{fileName,compilerOptions:{
    module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,
  }}).outputText;
}
for (const [id,file,digest] of [
  ['notice','app/redemption-undo-notice.tsx','e199a4797c3ea5b1531eab44ed7210da81fcccf04bcbe3524c08c763aef35a1c'],
  ['@/lib/redemption-undo-window','lib/redemption-undo-window.ts','a588e81889816e43294b4ec25947423b31416149fc1114786dd056588dcacae0'],
  ['@/lib/server-clock','lib/server-clock.ts','33301c81bd43b9e46c803bae5e381bd3c8c2b96eb557b51ffa1813ce8c1aaeeb'],
]) modules.set(id,compile(file,pinned(path.join(root,file),digest)));

const entry = `
  import {createRoot} from 'react-dom/client';
  import {serverClock} from '@/lib/server-clock';
  import {RedemptionUndoNotice} from 'notice';
  const probe = window.probe;
  const created = Date.parse('2001-01-01T12:00:00Z');
  Object.defineProperty(performance, 'now', {value: () => probe.age});
  serverClock.observe({serverTime:created+probe.age, processingMs:0}, probe.age, probe.age);
  const row = {id:'order', child_id:'child', request_id:'redeem', status:'pending',
    kind:'activity', cancelled_at:null, created_at:new Date(created).toISOString(), reward_name:'离线样例'};
  const data = {redemptions:[row],children:[{id:'child',nickname:'测试'}]};
  async function record(action, payload) { probe.calls.push({action,payload,age:probe.age}); }
  createRoot(document.getElementById('root')).render(
    <RedemptionUndoNotice data={data} childId="child" busy={false} mutate={record}/>);
`;

// One in-memory CommonJS graph. Unknown imports cannot reach Node or the network.
function browserBundle() {
  modules.set('fixture',compile('fixture.tsx',entry));
  const factories = Array.from(modules,([id,body])=>
    JSON.stringify(id)+':function(module,exports,require){\n'+body+'\n}'
  ).join(',\n');
  return `(() => {
    const factories={${factories}}, cache=new Map();
    function load(id) {
      if (cache.has(id)) return cache.get(id).exports;
      if (!Object.hasOwn(factories,id)) throw new Error('Unexpected browser module '+id);
      const module={exports:{}};
      cache.set(id,module);
      factories[id](module,module.exports,load);
      return module.exports;
    }
    load('fixture');
  })();`;
}

async function main() {
  const code = browserBundle();
  const browser = await chromium.launch({
    executablePath:values.chromium,
    headless:true,chromiumSandbox:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND','--no-proxy-server']
  });
  const results = [];
  try {
    for (const [receiptAge, clickAge, count] of [[7500,7999,1],[7999,8000,0],[7950,8001,0]]) {
      const context = await browser.newContext({offline:true,serviceWorkers:'block'});
      const requests=[],errors=[];
      try {
        context.on('request',r=>requests.push(r.url()));
        await context.route('**/*',r=>r.abort());
        await context.routeWebSocket('**/*',ws=>{requests.push(ws.url());return ws.close();});
        const page=await context.newPage();
        page.on('pageerror',e=>errors.push(e.message));
        await page.setContent('<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src \'none\'; script-src \'nonce-case36\'"><div id="root"></div>');
        await page.evaluate(({code,receiptAge})=>{
          window.probe={age:receiptAge,calls:[]};
          const script=document.createElement('script');script.nonce='case36';script.textContent=code;document.head.append(script);
        },{code,receiptAge});
        const button=page.getByRole('button',{name:'撤销刚才的奖励兑换',exact:true});
        await button.waitFor({state:'visible',timeout:4000});
        // Move time and click in one browser task. No timer tick or repaint can intervene.
        const result=await button.evaluate((el,ms)=>{
          window.probe.age=ms;
          const before={text:el.textContent,connected:el.isConnected,disabled:el.disabled};
          el.click();
          return {before,calls:window.probe.calls};
        },clickAge);
        assert.deepEqual(result.before,{text:'撤销（1秒）',connected:true,disabled:false});
        assert.deepEqual(result.calls,count?[{action:'redeem_undo',payload:{id:'order',child_id:'child'},age:clickAge}]:[]);
        if (!count) await button.waitFor({state:'detached',timeout:4000});
        assert.deepEqual(errors,[]); assert.deepEqual(requests,[]);
        results.push({receiptAge,clickAge,...result,detachedAfterTick:count?null:true,requests:requests.length});
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({fixture:'synthetic redemption boundary',checkoutVersion:version,browser:browser.version(),results}));
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
