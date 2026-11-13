#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// A bounded, read-only PromptPlaza client. No Remix, providers or internal imports.
import { constants } from 'node:fs';
import { open, lstat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_API = 'https://www.promptplaza.cn';
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const FILTERS = new Set(['kind','limit','offset','category','model','style','aspect','author','duration']);
const MAX_JSON_BYTES = 1024 * 1024;
const SKILL_ROOT = resolve(fileURLToPath(new URL('..',import.meta.url)));
function failure(code) { const e = new Error(code); e.code = code; return e; }
const object = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const text = (x,n=300) => typeof x === 'string' ? x.slice(0,n) : null;
const filled = x => typeof x === 'string' && x.trim() ? x : null;
function safeSourceUrl(value) {
  if (!filled(value) || value.length > 1600) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
function caseLinks(item, id) {
  const empty={canonical_path:null,case_url:null};
  if(typeof id!=='string'||!ID.test(id))return empty;
  const expected='/case/'+encodeURIComponent(id);
  if(item.canonical_path!=null&&item.canonical_path!==''){
    return item.canonical_path===expected?
      {canonical_path:item.canonical_path,case_url:DEFAULT_API+item.canonical_path}:empty;
  }
  for(const value of [item.case_url,item.detail_url]){
    if(typeof value!=='string'||value.length>1600)continue;
    try{
      const u=new URL(value);
      if(['https://www.promptplaza.cn','https://promptplaza.cn'].includes(u.origin)&&
          !u.username&&!u.password&&u.pathname===expected&&!u.search&&!u.hash)
        return {canonical_path:null,case_url:u.href};
    }catch{}
  }
  return empty;
}

export function explainFailure(error) {
  const code=typeof error?.code==='string'&&/^[A-Z0-9_]{3,64}$/.test(error.code)?error.code:'FAILED';
  let message='The request could not be completed.',next='Check the command and try again, or continue with your own prompt text.',retryable=false;
  if(['API_HTTP_401','API_HTTP_403'].includes(code)){
    message='The current session cannot access this case.';
    next='Open the official case page or supply text you have permission to use. Do not paste session tokens into chat.';
  }else if(code==='API_HTTP_404'){
    message='This case is unavailable or was not found.';next='Search for another case or use your own prompt text.';
  }else if(code==='API_HTTP_429'){
    message='The service request limit has been reached.';next='Wait and retry manually; do not keep sending requests.';retryable=true;
  }else if(/^API_HTTP_5\d\d$/.test(code)){
    message='The service is temporarily unavailable.';next='Retry manually later, or continue with your own prompt text.';retryable=true;
  }else if(['API_TIMEOUT','API_REQUEST_FAILED','API_READ_FAILED'].includes(code)){
    message=code==='API_TIMEOUT'?'The request timed out.':'The service could not be reached or read.';
    next='Check the connection and retry manually, or continue with your own prompt text.';retryable=true;
  }else if(code==='FULL_ORIGINAL_PROMPT_UNAVAILABLE'){
    message='No authorized complete original prompt was returned.';
    next='Open the official case page or supply your own text. Do not export an excerpt as an original.';
  }else if(code==='OUTPUT_EXISTS'){
    message='The output file already exists; it was not overwritten.';next='Choose a new absolute file path.';
  }else if(code.startsWith('OUTPUT_')||['ABSOLUTE_OUTPUT_REQUIRED','PROTECTED_OUTPUT'].includes(code)){
    message='The output path cannot be used.';next='Choose an existing private directory and a new absolute file path outside the Skill repository.';
  }else if(['UNTRUSTED_SESSION_ORIGIN','HTTPS_REQUIRED','INVALID_API_ORIGIN','INVALID_SESSION'].includes(code)){
    message='The API or session configuration was rejected.';next='Use the official HTTPS API and an existing supported authorized session. Keep credentials out of chat.';
  }else if(code==='CASE_ID_RESPONSE_MISMATCH'||code.startsWith('API_')){
    message='The service returned an unusable response.';next='Open the official site or try another case; do not invent missing source text or links.';
  }
  return {ok:false,error:code,message,next_step:next,retryable};
}
function integer(x, fallback, min, max) {
  if (x === undefined) return fallback;
  if (!/^\d+$/.test(String(x)) || +x < min || +x > max || !Number.isSafeInteger(+x)) throw failure('INVALID_INTEGER');
  return +x;
}
export function originOf(value) {
  let u; try { u = new URL(value); } catch { throw failure('INVALID_API_ORIGIN'); }
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password ||
      u.pathname !== '/' || u.search || u.hash) throw failure('INVALID_API_ORIGIN');
  const host = u.hostname.toLowerCase();
  const local = ['localhost','127.0.0.1','[::1]','::1'].includes(host);
  if (u.protocol !== 'https:' && !local) throw failure('HTTPS_REQUIRED');
  return { url:u.origin, host, local };
}
function options(args) {
  const [action,...rest]=args;
  if (!action || action==='help' || action==='--help') return {action:'help',pos:[],opt:{}};
  if (!['search','get','download'].includes(action)) throw failure('UNKNOWN_COMMAND');
  const pos=[],opt={};
  const allowed=action==='search'?FILTERS:action==='download'?new Set(['output']):new Set();
  for(let i=0;i<rest.length;i++) {
    if(!rest[i].startsWith('--')) {pos.push(rest[i]);continue;}
    const key=rest[i].slice(2);
    if(!allowed.has(key)||Object.hasOwn(opt,key)) throw failure('INVALID_OPTION');
    const value=rest[++i];if(!value||value.startsWith('--'))throw failure('OPTION_VALUE_REQUIRED');
    opt[key]=value;
  }
  return {action,pos,opt};
}
async function getJson(path, fetchImpl, env) {
  const origin=originOf(env.PROMPTPLAZA_API_BASE||DEFAULT_API);
  const token=env.PROMPTPLAZA_TOKEN||'';
  if(typeof token!=='string'||token.length>4096||/\s/.test(token)) throw failure('INVALID_SESSION');
  if(token&&!origin.local&&!['https://www.promptplaza.cn','https://promptplaza.cn'].includes(origin.url))throw failure('UNTRUSTED_SESSION_ORIGIN');
  const headers={Accept:'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  let response;
  const signal=AbortSignal.timeout(15000);
  try {
    response=await fetchImpl(origin.url+path,{
      method:'GET',headers,redirect:'error',signal
    });
  } catch(e) { throw failure(signal.aborted||['AbortError','TimeoutError'].includes(e?.name)?'API_TIMEOUT':'API_REQUEST_FAILED'); }
  if(!response||!Number.isInteger(response.status))throw failure('API_RESPONSE_INVALID');
  if(!response.ok)throw failure('API_HTTP_'+response.status);
  if(typeof response.body?.getReader!=='function')throw failure('API_RESPONSE_INVALID');
  const reader=response.body.getReader(),chunks=[];
  let bytes=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_JSON_BYTES)throw failure('API_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  }catch(e){
    await reader.cancel().catch(()=>{});
    if(e?.code==='API_RESPONSE_TOO_LARGE')throw e;
    throw failure(signal.aborted||['AbortError','TimeoutError'].includes(e?.name)?'API_TIMEOUT':'API_READ_FAILED');
  }finally{reader.releaseLock();}
  let body;
  try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw failure('API_JSON_INVALID');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw failure('API_RESPONSE_INVALID');
  if(body.ok===false)throw failure('API_REPORTED_FAILURE');
  return body;
}
export function projectCase(body) {
  const root=object(body);
  const nestedCase=root.case&&typeof root.case==='object'&&!Array.isArray(root.case);
  const nestedItem=root.item&&typeof root.item==='object'&&!Array.isArray(root.item);
  const cardOnly=!nestedCase&&!nestedItem&&root.card&&typeof root.card==='object';
  const item=nestedCase?object(root.case):nestedItem?object(root.item):cardOnly?object(root.card):root;
  const status=filled(item.prompt_status);
  const blocked=root.prompt_blocked||item.prompt_blocked||object(root.card).prompt_blocked;
  const a=object(root.actions),b=object(item.actions);
  const permitted=root.copyable===true||item.copyable===true||a.copy===true||b.copy===true;
  const denied=root.copyable===false||item.copyable===false||a.copy===false||b.copy===false;
  // A card is preview metadata. Never borrow source text/status from a wrapper.
  const candidate=filled(item.prompt);
  const original=!cardOnly&&root.ok!==false&&item.ok!==false&&status==='full'&&
    !blocked&&permitted&&!denied&&candidate&&
    Buffer.byteLength(candidate,'utf8')<=32000?candidate:null;
  const license=text(object(root.rights).license||object(item.rights).license,120)||'UNSPECIFIED';
  const id=item.id||root.id;
  const access=original?'full':blocked||denied?'restricted':
    ['excerpt','missing','translation_only'].includes(status)?status:'unavailable';
  return {schema:'promptplaza-basic-case-v1',case_id:text(id,128),
    title:text(item.title||item.title_zh||root.title),kind:text(item.kind||item.type||root.kind,24),
    ...caseLinks(item,id),
    source_url:safeSourceUrl(item.source_url||root.source_url),
    prompt_status:text(status,40),prompt_access:access,prompt_available:Boolean(original),prompt:original||null,
    prompt_notice:original?null:'No authorized complete original was returned. Open the official case page or supply your own text.',
    rights_license:license,republication_authorized_by_skill:false,
    source_authenticity_certified_by_skill:false};
}
async function readCase(id,fetchImpl,env) {
  let body;
  try {
    body=await getJson('/v1/cases/'+encodeURIComponent(id)+'/prompt',fetchImpl,env);
  } catch(error) {
    // An older server can still provide public metadata. Never recover source
    // bytes from this fallback, or retry access/session/rate/service failures.
    if(error?.code!=='API_HTTP_404')throw error;
    const detail=projectCase(await getJson('/v1/cases/'+encodeURIComponent(id),fetchImpl,env));
    if(detail.case_id!==id)throw failure('CASE_ID_RESPONSE_MISMATCH');
    return {...detail,prompt:null,prompt_available:false,prompt_access:'unavailable',
      prompt_notice:'The original-text endpoint is unavailable. Open the official case page or supply your own text.',
      source_endpoint_available:false,source_prompt_sha256:null};
  }
  if(body.ok!==true||body.schema!=='promptplaza-public-source-v1'||body.source!=='authorized-public-copy-v1'||
      !body.case||typeof body.case!=='object'||Array.isArray(body.case)||
      !['image','video'].includes(body.case.kind))throw failure('API_SOURCE_CONTRACT_INVALID');
  const detail=projectCase(body);
  if(detail.case_id!==id)throw failure('CASE_ID_RESPONSE_MISMATCH');
  let sourceHash=null;
  if(detail.prompt_available){
    const expected=body.case.prompt_sha256;
    const bytes=Buffer.byteLength(detail.prompt,'utf8');
    sourceHash=createHash('sha256').update(detail.prompt,'utf8').digest('hex');
    if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||
        expected!==sourceHash||body.case.prompt_bytes!==bytes)throw failure('API_SOURCE_INTEGRITY_INVALID');
  }
  return {...detail,source_endpoint_available:true,source_prompt_sha256:sourceHash};
}
function projectSearch(body,limit) {
  const metadata=(value,max)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):null;
  const durationTags=value=>Array.isArray(value)?[...new Set(value
    .filter(x=>typeof x==='string'&&x.trim()&&x.length<=80).map(x=>x.trim()))].slice(0,8):[];
  const rows=Array.isArray(body.items)?body.items.slice(0,limit):[];
  return {schema:'promptplaza-basic-search-v1',
    total:Number.isInteger(body.total)?body.total:null,
    next_offset:Number.isInteger(body.next_offset)?body.next_offset:null,
    items:rows.map(raw=>{const x=object(raw);return {
      case_id:text(x.id,128),title:text(x.title||x.title_zh),kind:text(x.kind||x.type,24),
      ...caseLinks(x,x.id),
      model:text(x.model,80),aspect:text(x.aspect||x.ratio,20),
      author:metadata(x.author,120),author_handle:metadata(x.author_handle,80),
      duration_s:typeof x.duration_s==='number'&&Number.isFinite(x.duration_s)&&x.duration_s>0?x.duration_s:null,
      search_tags:{duration:durationTags(object(x.search_tags).duration)},
      model_evidence_scope:metadata(x.model_evidence_scope,120),model_execution_verified_by_skill:false,
      source_url:safeSourceUrl(x.source_url),
      rights_license:text(object(x.rights).license,120)||'UNSPECIFIED',
      prompt_available_in_listing:false};})};
}
async function outputPath(path,cwd) {
  if(typeof path!=='string'||!isAbsolute(path))throw failure('ABSOLUTE_OUTPUT_REQUIRED');
  const target=resolve(path),work=resolve(cwd);
  if([work,SKILL_ROOT].some(base=>target===base||target.startsWith(base+sep)))
    throw failure('OUTPUT_INSIDE_REPOSITORY');
  if(['.env','.env.local','.npmrc'].includes(target.split(sep).at(-1)))throw failure('PROTECTED_OUTPUT');
  let p=dirname(target);
  while(true){
    let st;try{st=await lstat(p);}catch{throw failure('OUTPUT_PARENT_INVALID');}
    if(st.isSymbolicLink()||!st.isDirectory())throw failure('OUTPUT_PARENT_INVALID');
    const next=dirname(p);if(next===p)break;p=next;
  }
  try{await lstat(target);}
  catch(error){
    if(error?.code==='ENOENT')return target;
    throw failure('OUTPUT_CREATE_FAILED');
  }
  throw failure('OUTPUT_EXISTS');
}
async function writeNew(path,prompt){
  let handle;
  try {
    handle=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|
      (constants.O_NOFOLLOW||0),0o600);
  }catch(e){throw failure(e?.code==='EEXIST'?'OUTPUT_EXISTS':'OUTPUT_CREATE_FAILED');}
  try{await handle.writeFile(prompt,{encoding:'utf8'});}
  catch{try{await handle.close();}finally{await unlink(path).catch(()=>{});}throw failure('OUTPUT_WRITE_FAILED');}
  await handle.close();
}
export async function execute(argv,{env=process.env,fetchImpl=fetch,cwd=process.cwd()}={}){
  const {action,pos,opt}=options(argv);
  if(action==='help')return {commands:['search [TOPIC] [--author HANDLE] [--duration TAG] [--kind image|video] [--limit 1..20]',
    'get CASE_ID','download CASE_ID --output /absolute/new/file.txt'],
    source:'live authorized Plaza API only',generation_calls:0};
  if(action==='search'){
    const query=pos.join(' ').trim();
    const author=opt.author===undefined?undefined:opt.author.trim().replace(/^@/,'').trim();
    if((!query&&author===undefined)||query.length>200)throw failure('SEARCH_QUERY_INVALID');
    if(opt.kind&&!['image','video'].includes(opt.kind))throw failure('SEARCH_KIND_INVALID');
    const limit=integer(opt.limit,8,1,20),offset=integer(opt.offset,0,0,10000);
    const q=new URLSearchParams({q:query,limit:String(limit),offset:String(offset)});
    for(const key of ['kind','category','model','style','aspect','author','duration']){
      if(opt[key]===undefined)continue;
      const value=key==='author'?author:opt[key];
      if(!value.trim()||value.length>80||/[\u0000-\u001f\u007f]/.test(value))throw failure('SEARCH_FILTER_INVALID');
      q.set(key,value);
    }
    return projectSearch(await getJson('/v1/explore?'+q.toString(),fetchImpl,env),limit);
  }
  if(pos.length!==1||!ID.test(pos[0]))throw failure('CASE_ID_INVALID');
  const id=pos[0];
  const target=action==='download'?await outputPath(opt.output,cwd):null;
  const detail=await readCase(id,fetchImpl,env);
  if(action==='get')return detail;
  if(!detail.prompt_available)throw failure('FULL_ORIGINAL_PROMPT_UNAVAILABLE');
  await writeNew(target,detail.prompt);
  return {schema:'promptplaza-basic-download-v1',case_id:id,output:target,
    bytes:Buffer.byteLength(detail.prompt,'utf8'),
    prompt_sha256:createHash('sha256').update(detail.prompt,'utf8').digest('hex'),
    rights_license:detail.rights_license,republication_authorized_by_skill:false,generation_calls:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  execute(process.argv.slice(2))
    .then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n'))
    .catch(error=>{
      process.stderr.write(JSON.stringify(explainFailure(error))+'\n');
      process.exitCode=2;
    });
}
