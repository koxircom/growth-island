import pg from 'pg';
let chunks=[],size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>6000000)throw Error('input_too_large');chunks.push(chunk);}
const p=JSON.parse(Buffer.concat(chunks).toString('utf8'));
if(!p||!['claim','status','complete','fail'].includes(p.action)||Object.keys(p).some(k=>!['action','job_id','revision','lease_token','audio_base64','error_code'].includes(k)))throw Error('invalid_request');
if(p.action==='complete'){
 const b=Buffer.from(p.audio_base64||'','base64');let pos=12,fmt=false,data=false,rate=0,align=0,dataSize=0;
 if(b.length<44||b.length>4194304||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.readUInt32LE(4)+8!==b.length)throw Error('invalid_audio');
 while(pos+8<=b.length){const id=b.toString('ascii',pos,pos+4),n=b.readUInt32LE(pos+4);pos+=8;if(pos+n>b.length)throw Error('invalid_audio');
 if(id==='fmt '){if(fmt||n<16||b.readUInt16LE(pos)!==1||![1,2].includes(b.readUInt16LE(pos+2))||![16000,22050,24000,44100,48000].includes(b.readUInt32LE(pos+4))||b.readUInt16LE(pos+14)!==16)throw Error('invalid_audio');rate=b.readUInt32LE(pos+4);align=b.readUInt16LE(pos+12);if(align!==b.readUInt16LE(pos+2)*2||b.readUInt32LE(pos+8)!==rate*align)throw Error('invalid_audio');fmt=true;}
 if(id==='data'){if(data||n===0)throw Error('invalid_audio');data=true;dataSize=n;}pos+=n+(n%2);}
 if(!fmt||!data||pos!==b.length||dataSize%align!==0||dataSize>rate*align*120)throw Error('invalid_audio');
}
const db=new pg.Client({connectionString:process.env.HABIT_VOICE_DATABASE_URL});await db.connect();
try{if((await db.query('SELECT current_user u')).rows[0].u!=='growth_voice_worker')throw Error('wrong_database_role');
 console.log(JSON.stringify((await db.query('SELECT public.habit_voice_work($1::jsonb) result',[JSON.stringify(p)])).rows[0].result));
}catch(e){if(e?.code==='P0001'&&['lease_conflict','lease_expired','audio_conflict'].includes(e.message)){console.log(JSON.stringify({error:e.message}));}else{console.error('habit_voice_worker_failed');process.exitCode=1;}}finally{await db.end();}
