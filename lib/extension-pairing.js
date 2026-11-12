'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');

// Pairing is local to this macOS account and is not embedded in the extension.
const pairingFile=process.env.YOURTUBE_PAIRING_FILE||path.join(os.homedir(),'Library','Application Support','YourTube','extension-token');
const extensionOrigin='chrome-extension://anbgckjkfioebbbhigpolefmhhllkdhh';

function readToken(){
 const fd=fs.openSync(pairingFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||(stat.mode&0o077)!==0||(process.getuid&&stat.uid!==process.getuid())||stat.size>128)throw Error('Invalid pairing file');
  const value=fs.readFileSync(fd,'utf8').trim();
  if(!/^[a-f0-9]{64}$/.test(value))throw Error('Invalid pairing file');
  return value;
 }finally{fs.closeSync(fd)}
}

function createOrReadToken(){
 try{return readToken()}catch(e){if(e.code!=='ENOENT')throw e}
 fs.mkdirSync(path.dirname(pairingFile),{recursive:true,mode:0o700});
 const value=crypto.randomBytes(32).toString('hex');
 let fd;
 try{
  fd=fs.openSync(pairingFile,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  fs.writeFileSync(fd,value+'\n',{encoding:'utf8'});fs.fsyncSync(fd);
 }catch(e){
  if(e.code==='EEXIST')return readToken();
  throw e;
 }finally{if(fd!==undefined)fs.closeSync(fd)}
 return value;
}

function authorized(req){
 if(req.headers.origin!==extensionOrigin)return false;
 const match=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||'');
 if(!match)return false;
 try{return crypto.timingSafeEqual(Buffer.from(match[1],'hex'),Buffer.from(readToken(),'hex'))}catch{return false}
}
function revokeToken(){try{readToken();fs.unlinkSync(pairingFile)}catch(e){if(e.code!=='ENOENT')throw e}}
module.exports={createOrReadToken,revokeToken,authorized,extensionOrigin};
