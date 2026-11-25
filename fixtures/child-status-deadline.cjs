// Run with Node from this checkout. NODE_PATH may point at its installed candidate dependencies.
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {parseArgs} = require('node:util');
const {chromium} = require('playwright');

const {values} = parseArgs({options: {chromium:{type:'string'}, source:{type:'string'}}});
const root = path.resolve(values.source || path.join(__dirname, '..'));

async function componentBundle() {
  const {rolldown} = await import(pathToFileURL(require.resolve('rolldown')));
  const deps = path.dirname(path.dirname(require.resolve('react/package.json')));
  const build = await rolldown({
    cwd:root, input:'fixture-entry', platform:'browser',
    resolve:{modules:[deps], alias:{'@':root}},
    transform:{jsx:'react-jsx', define:{'process.env.NODE_ENV':'"development"'}},
    plugins:[{
      name:'fixture-entry',
      resolveId(id) { if (id === 'fixture-entry') return '\0fixture-entry'; },
      load(id) {
        if (id !== '\0fixture-entry') return;
        return [
          "import * as React from 'react';",
          "import {createRoot} from 'react-dom/client';",
          "import {flushSync} from 'react-dom';",
          "import {ChildAccessControls} from '@/app/child-access-controls';",
          "window.fixtureModules = {React,createRoot,flushSync,ChildAccessControls};",
        ].join('\n');
      },
    }],
  });
  try { return (await build.generate({format:'iife'})).output[0].code; }
  finally { await build.close(); }
}

function installFixture() {
  const {React, createRoot, flushSync, ChildAccessControls} = window.fixtureModules;
  window.IS_REACT_ACT_ENVIRONMENT = true;
  const target = document.getElementById('fixture');
  const children = ['a','b'].map(id => ({id, nickname:id}));
  const calls = [], commits = [], notifications = [];
  let root, props;
  const visible = () => !!target.querySelector('.child-access-bar button');
  window.fetch = (url, options) => {
    const {action} = JSON.parse(options.body);
    if (url !== '/api/child-access' || !['status','lock'].includes(action)) throw Error('Unexpected fixture request');
    return new Promise((resolve,reject) => calls.push({action, resolve, reject}));
  };
  window.addEventListener('island-child-access-changed', () => notifications.push('access'));
  window.BroadcastChannel = class { postMessage() { notifications.push('broadcast'); } };

  function Surface(p) {
    React.useLayoutEffect(() => { commits.push(visible()); }, [p.childId,p.parentToken,p.parentMode]);
    return React.createElement(ChildAccessControls,p);
  }
  const render = () => root.render(React.createElement(Surface,props));
  function settle(index,data) {
    const call = calls[index];
    if (call?.action !== 'status') throw Error('Expected a pending status');
    if (data === 'network-error') call.reject(Error('synthetic failure'));
    else call.resolve({ok:true,json:async () => ({data})});
  }
  window.fixture = {
    async reset() {
      if (root) await React.act(async () => root.unmount());
      calls.length = commits.length = 0;
      root = createRoot(target);
      props = {children,childId:'a',parentMode:false,parentToken:'session-one',
        onParentNeeded:()=>{},onEnroll:()=>{}};
      await React.act(async () => render());
      return calls.length-1;
    },
    async focus() {
      await React.act(async () => window.dispatchEvent(new Event('focus')));
      return calls.length-1;
    },
    async respond({index,data}) {
      await React.act(async () => settle(index,data));
      return visible();
    },
    async switchAndReply({changes,index,data}) {
      await React.act(async () => {
        props = {...props,...changes};
        flushSync(render);
        settle(index,data);
      });
      return {duringCommit:commits.at(-1), afterReply:visible()};
    },
    visible, notifications,
  };
}

async function main() {
  const code = await componentBundle();
  const browser = await chromium.launch({headless:true, executablePath:values.chromium, chromiumSandbox:true,
    args:['--disable-background-networking','--disable-component-update','--disable-sync']});
  try {
    const context = await browser.newContext({offline:true,serviceWorkers:'block'});
    const requests = [], errors = [];
    context.on('request', request => requests.push(request.url()));
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.clock.install({time:new Date('2000-01-01T00:00:00Z')});
    await page.clock.pauseAt(new Date('2000-01-01T00:00:01Z'));
    await page.setContent('<main id="fixture"></main>');
    await page.addScriptTag({content:code});
    await page.evaluate(installFixture);
    await page.exposeBinding('advanceFixtureClock', ({page}, ms) => page.clock.runFor(ms));
    const advance = ms => page.evaluate(async ms => {
      await fixtureModules.React.act(() => window.advanceFixtureClock(ms));
    }, ms);
    const reset = () => page.evaluate(() => fixture.reset());
    const focus = () => page.evaluate(() => fixture.focus());
    const visible = () => page.evaluate(() => fixture.visible());
    const reply = (index,data) => page.evaluate(args => fixture.respond(args),{index,data});
    const switchAndReply = (changes,index,data) => page.evaluate(args => fixture.switchAndReply(args),{changes,index,data});
    const server = Date.parse('2042-01-02T12:00:00Z');
    function status(ttl, overrides={}) {
      return {children:['a','b'].map(id => ({id,configured:true})), unlocked_child_id:'a', enrollment_child_id:null,
        server_now:new Date(server).toISOString(), expires_at:new Date(server+ttl).toISOString(), ...overrides};
    }

    const checks = [];
    const check = (name,actual,expected) => checks.push({name, pass:JSON.stringify(actual)===JSON.stringify(expected), actual, expected});
    let pending = await reset();
    check('immediate response',await reply(pending,status(750)),true);
    await advance(749);
    check('last millisecond',await visible(),true);
    await advance(1);
    check('expires without another response',await visible(),false);

    pending = await reset();
    await advance(300);
    check('300 ms response delay exceeds 200 ms remaining',await reply(pending,status(200)),false);
    pending = await reset();
    await advance(125);
    check('125 ms response delay leaves part of 400 ms',await reply(pending,status(400)),true);
    await advance(274);
    check('partial delay still visible at request +399 ms',await visible(),true);
    await advance(1);
    check('partial delay expires at request +400 ms',await visible(),false);

    pending = await reset();
    await reply(pending,status(300));
    await advance(60);
    // Same server expiry, with a newer estimate that would extend the prior bound.
    await reply(await focus(),status(300,{server_now:new Date(server+20).toISOString()}));
    await advance(240);
    check('same expiry keeps earlier bound',await visible(),false);

    const locked = status(0,{unlocked_child_id:null,expires_at:null});
    pending = await reset();
    await reply(await focus(),locked);
    check('older success after locked response',await reply(pending,status(600)),false);
    pending = await reset();
    await reply(await focus(),status(600));
    check('older failure after valid response',await reply(pending,'network-error'),true);

    for (const [name,changes,child] of [
      ['child changes in the reply turn',{childId:'b'},'b'],
      ['session changes in the reply turn',{parentToken:'session-two'},'a'],
    ]) {
      await reply(await reset(),status(700));
      check(name,await switchAndReply(changes,await focus(),status(700,{unlocked_child_id:child})),
        {duringCommit:false,afterReply:false});
    }

    for (const [name,data] of [
      ['server expiry reached',status(0)],
      ['server expiry passed',status(-1)],
      ['wrong child',status(100,{unlocked_child_id:'b'})],
      ['missing server timestamp',status(100,{server_now:null})],
      ['ambiguous local timestamp',status(100,{server_now:'2042-01-02T12:00:00'})],
      ['invalid calendar date',status(100,{server_now:'2042-02-30T00:00:00Z',expires_at:'2042-03-02T00:01:00Z'})],
      ['more than ten minutes',status(600_001)],
      ['submillisecond remainder',status(100,{server_now:'2042-01-02T12:00:00.000999+00:00',expires_at:'2042-01-02T12:00:00.001001+00:00'})],
    ]) {
      await reply(await reset(),status(600));
      check(name,await reply(await focus(),data),false);
    }
    const tenMinutes = status(600_000,{server_now:'2042-01-02T20:00:00.000000+08:00'});
    check('zoned ten-minute session',await reply(await reset(),tenMinutes),true);
    check('untrusted refresh clears display',await reply(await focus(),{...tenMinutes,server_now:null}),false);
    check('valid sample restores display',await reply(await focus(),tenMinutes),true);
    check('real network requests',requests,[]);
    check('status scope notifications',await page.evaluate(() => fixture.notifications),[]);
    check('page errors',errors,[]);
    console.log(JSON.stringify({browser:browser.version(),checks},null,2));
    assert.ok(checks.every(c=>c.pass), 'One or more status display checks failed');
  } finally { await browser.close(); }
}
main().catch(error => {console.error(error); process.exitCode=1;});
