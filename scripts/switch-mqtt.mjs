// One bounded MQTT 3.1.1 connection. PUBACK never means device execution.
import net from 'node:net';
import {EventEmitter} from 'node:events';
const str=s=>{const data=Buffer.from(s,'utf8'),n=Buffer.alloc(2);if(data.length>65535)throw Error('mqtt_string_limit');n.writeUInt16BE(data.length);return Buffer.concat([n,data]);};
function packet(kind,data){let n=data.length,parts=[];do{let b=n%128;n=Math.floor(n/128);parts.push(b|(n?128:0));}while(n);return Buffer.concat([Buffer.from([kind,...parts]),data]);}
export class SwitchMqtt extends EventEmitter{
 constructor(config){super();this.config=config;this.buffer=Buffer.alloc(0);this.open=false;this.on('error',()=>{});}
 async connect(){
  if(this.socket)throw Error('mqtt_already_started');
  const {host,port=1883,username,password,clientId}=this.config;
  if(typeof host!=='string'||!Number.isInteger(port)||port<1||port>65535||typeof username!=='string'||typeof password!=='string'||typeof clientId!=='string')throw Error('invalid_mqtt_config');
  this.socket=net.createConnection({host,port});this.socket.setNoDelay(true);
  this.socket.on('data',chunk=>{try{this.receive(chunk);}catch{this.socket.destroy(Error('mqtt_packet_invalid'));}});
  this.socket.on('error',()=>{this.emit('error',Error('mqtt_connection_failed'));});
  this.socket.on('close',()=>{this.open=false;clearInterval(this.pinger);this.emit('disconnect');});
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{finish(Error('mqtt_connect_timeout'));this.socket.destroy();},10000);
   const connected=()=>finish(),failed=()=>finish(Error('mqtt_connection_failed'));
   const finish=error=>{clearTimeout(timer);this.off('connack',connected);this.off('error',failed);this.off('disconnect',failed);error?reject(error):resolve();};
   this.once('connack',connected);this.once('error',failed);this.once('disconnect',failed);
   this.socket.once('connect',()=>this.socket.write(packet(0x10,Buffer.concat([str('MQTT'),Buffer.from([4,0xc2,0,30]),str(clientId),str(username),str(password)]))));
  });
  this.pinger=setInterval(()=>{if(this.open)this.socket.write(packet(0xc0,Buffer.alloc(0)));},10000);this.pinger.unref();
 }
 receive(chunk){
  this.buffer=Buffer.concat([this.buffer,chunk]);if(this.buffer.length>262144)throw Error('mqtt_buffer_limit');
  while(this.buffer.length>=2){
   let n=0,m=1,i=1,byte;do{if(i>=this.buffer.length)return;if(i>4)throw Error('mqtt_length');byte=this.buffer[i++];n+=(byte&127)*m;m*=128;}while(byte&128);
   if(n>131072)throw Error('mqtt_packet_limit');if(this.buffer.length<i+n)return;
   const kind=this.buffer[0],body=this.buffer.subarray(i,i+n);this.buffer=this.buffer.subarray(i+n);
   if(kind===0x20){if(body.length!==2||body[0]!==0||body[1]!==0)throw Error('mqtt_auth_refused');this.open=true;this.emit('connack');}
   else if(kind>>4===3){
    if(body.length<2)throw Error('mqtt_publish_short');const len=body.readUInt16BE(0);let at=2+len;if(at>body.length)throw Error('mqtt_topic');
    const topic=body.subarray(2,at).toString('utf8'),qos=(kind>>1)&3;
    if(qos===1){if(at+2>body.length)throw Error('mqtt_qos');this.socket.write(packet(0x40,body.subarray(at,at+2)));at+=2;}
    else if(qos!==0)throw Error('mqtt_qos_unsupported');
    this.emit('message',{topic,retained:!!(kind&1),payload:body.subarray(at).toString('utf8')});
   }
  }
 }
 subscribe(topic){if(!this.open)throw Error('mqtt_not_connected');this.socket.write(packet(0x82,Buffer.concat([Buffer.from([0,1]),str(topic),Buffer.from([0])])));}
 publish(topic,wire){if(!this.open)throw Error('mqtt_not_connected');this.socket.write(packet(0x30,Buffer.concat([str(topic),Buffer.from(wire,'utf8')])));}
 close(){clearInterval(this.pinger);if(this.open)this.socket.write(packet(0xe0,Buffer.alloc(0)));this.socket?.end();}
}
