export const dynamic="force-dynamic";
export default function TestEntry(){
 const raw=process.env.SWITCH_TEST_OWNER_ORIGIN;
 let href="";
 try{const u=new URL(raw||"");if(u.protocol==="https:"&&!u.username&&!u.password&&u.pathname==="/"&&!u.search&&!u.hash)href=u.origin+"/parent/switch-test";}catch{}
 return <main style={{maxWidth:560,margin:"32px auto",padding:20}}><h1>Switch 测试</h1><p>一次 10 分钟，不扣星星。</p>{href?<a href={href} target="_top" referrerPolicy="no-referrer">打开家长测试入口</a>:<p>测试入口尚未配置。</p>}</main>;
}
