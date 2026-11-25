import{build,createServer as viteServer}from'vite';import{chromium}from'@playwright/test';import{NextRequest}from'next/server.js';import pg from'pg';import assert from'node:assert/strict';import{mkdtemp,readFile,writeFile}from'node:fs/promises';import{join,resolve}from'node:path';import{tmpdir}from'node:os';import{createServer}from'node:http';
const root=resolve('..'),socket=root+'/e2e-pg';
process.env.DATABASE_URL='postgresql://growth_app@/postgres?host='+socket+'&port=55510';
const db=new pg.Client({connectionString:'postgresql://postgres@/postgres?host='+socket+'&port=55510'});await db.connect();
const temp=await mkdtemp(join(tmpdir(),'voice-e2e-'));await build({configFile:false,define:{"process.env.NODE_ENV":JSON.stringify("production")},resolve:{alias:{'@':resolve('.')}},build:{outDir:temp,lib:{entry:resolve('qa/auto-voice-fixture.tsx'),formats:['iife'],name:'QA',fileName:()=> 'app.js'}}});
const vite=await viteServer({configFile:false,resolve:{alias:{'@':resolve('.')}},server:{middlewareMode:true}});
const route=await vite.ssrLoadModule('/app/api/habit-voice/route.ts');const errors=[];let delay=0;
const server=createServer(async(req,res)=>{try{
if(req.url==='/api/habit-voice'){const parts=[];for await(const c of req)parts.push(c);const answer=await route.POST(new NextRequest(process.env.APP_ORIGIN+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(parts)}));if(delay)await new Promise(r=>setTimeout(r,delay));res.writeHead(answer.status,Object.fromEntries(answer.headers));res.end(Buffer.from(await answer.arrayBuffer()));}
else if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(await readFile(join(temp,'app.js')));}
else if(req.url==='/audio/child-v7/habit-voice-pending.wav'){res.setHeader('Content-Type','audio/wav');res.end(await readFile('public'+req.url));}
else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<meta charset="utf-8"><div id="root"></div><script src="/app.js"></script>');}
}catch(e){errors.push(String(e));res.statusCode=500;res.end('fixture_error');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));process.env.APP_ORIGIN='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'/home/koxir/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',args:['--autoplay-policy=no-user-gesture-required']});const context=await browser.newContext();
await context.addCookies([{name:'growth_session',value:'f'.repeat(64),url:process.env.APP_ORIGIN},{name:'growth_child_browser',value:'a'.repeat(64),url:process.env.APP_ORIGIN}]);
const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.played=0;window.ended=0;const native=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer&&this.buffer.duration>0.1){window.played++;this.addEventListener('ended',()=>window.ended++);}return native.apply(this,args);};});
let result;
try{
await db.query("UPDATE public.habits SET name=$1 WHERE id=$2",["整理书包。","00000000-0000-4000-8000-000000000004"]);
await page.goto(process.env.APP_ORIGIN);await page.locator('button').click();await page.waitForFunction(()=>window.played===1);await page.waitForFunction(()=>window.ended===1);assert.equal(await page.locator('button').getAttribute('aria-pressed'),'false');
await db.query("UPDATE public.habits SET name='新合成习惯' WHERE id='00000000-0000-4000-8000-000000000004'");
await page.evaluate(()=>window.setName('新合成习惯'));await page.locator('button').click();await page.waitForFunction(()=>window.played===2);await page.waitForFunction(()=>window.ended===2);assert.equal(await page.locator('button').getAttribute('aria-pressed'),'false');
await page.evaluate(()=>window.setVoice({enabled:false}));await page.locator('button').click();assert.equal(await page.locator('[role=status]').textContent(),'语音已静音，请开启顶部声音开关。');assert.equal(await page.evaluate(()=>window.played),2);
await page.evaluate(()=>window.setVoice({enabled:true}));
delay=600;await page.locator('button').click();await page.evaluate(()=>window.setShow(false));await page.waitForTimeout(900);assert.equal(await page.evaluate(()=>window.played),2);
assert.deepEqual(errors,[]);
result={passed:true,actual_native_audio_starts:2,actual_native_audio_ends:2,ready_audio_from:'Windows generated WAV via real SSH into isolated PostgreSQL, real authenticated API',pending_audio:'exact Qwen prompt SHA verified in browser',checks:['ready playback','pending exact prompt','onended resets button','mute','unmount rejects late response'],subjective_listening:false};
await writeFile('qa/auto-voice-e2e-independent-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await vite.close();await new Promise(r=>server.close(r));await db.end();await globalThis.growthPool?.end();}

