#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Bounded public client. Creative methods execute only on the private service; no engine imports.
import { constants } from 'node:fs';
import { open, lstat, unlink, mkdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_API = 'https://www.promptplaza.cn';
const OFFICIAL_API_ORIGINS = new Set([DEFAULT_API,'https://promptplaza.cn']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const FILTERS = new Set(['kind','limit','offset','category','model','style','aspect','author','duration','request-id','cursor']);
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_CREATIVE_BYTES = 256 * 1024;
const CREATIVE_OPERATIONS = Object.freeze([
  'compile','revise','remix','remix-revise','interview-new','interview-next','interview-answer',
  'case-ideas','recipe-catalog','recipe-compile'
]);
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const SERVICE_ERRORS = new Set([
  'SKILL_AUTH_REQUIRED','SKILL_AUTH_UNAVAILABLE','SKILL_ADMISSION_UNAVAILABLE',
  'SKILL_QUOTA_EXCEEDED','SKILL_QUOTA_EXHAUSTED','SKILL_BUSY','SKILL_REQUEST_CONFLICT','SKILL_INVALID_INPUT',
  'SKILL_INPUT_INVALID','SKILL_INPUT_TOO_LARGE','SKILL_BODY_TOO_LARGE','SKILL_REQUEST_TOO_LARGE',
  'SKILL_UNSUPPORTED_OPERATION','SKILL_UNKNOWN_OPERATION','SKILL_INVALID_REQUEST_ID',
  'SKILL_WORKER_UNAVAILABLE','SKILL_WORKER_FAILED','SKILL_WORKER_TIMEOUT',
  'SKILL_SERVICE_UNAVAILABLE','SKILL_SERVICE_FAILED','SKILL_OUTPUT_TOO_LARGE',
  'SKILL_EXECUTION_UNAVAILABLE','SKILL_AUTH_TIMEOUT','SKILL_ADMISSION_TIMEOUT',
  'SKILL_READ_TIMEOUT','SKILL_REQUEST_ABORTED','SKILL_DEPENDENCY_UNAVAILABLE',
  'SKILL_RESULT_INVALID','SKILL_INTERNAL_ERROR','SKILL_ROUTE_NOT_FOUND',
  'SKILL_JSON_REQUIRED','SKILL_JSON_INVALID','SKILL_INPUT_REQUIRED',
  'SKILL_INPUT_FIELDS_INVALID','SKILL_INPUT_TOO_COMPLEX','SKILL_SCHEMA_INVALID',
  'SKILL_OPERATION_INVALID','SKILL_REQUEST_ID_INVALID','SKILL_METHOD_NOT_ALLOWED',
  'SKILL_SITE_ASSETS_UNAVAILABLE','SKILL_ASSET_INVALID','SKILL_ASSET_CHANGED','SKILL_ASSET_INTEGRITY',
  'SKILL_ASSET_INPUT_INVALID','SKILL_CASE_UNAVAILABLE','SKILL_RECIPE_NOT_FOUND','SKILL_RECIPE_INPUT_INVALID',
  'SOURCE_PROMPT_MISSING','SOURCE_PROMPT_TOO_LARGE','SPEC_TOO_LARGE',
  'SKILL_REQUEST_PENDING','SKILL_REQUEST_UNKNOWN','SKILL_REQUEST_NOT_FOUND','SKILL_RECEIPT_LIMIT','SKILL_ORIGIN_DENIED',
  'SKILL_SEARCH_UNAVAILABLE','SKILL_SEARCH_CURSOR_INVALID','SKILL_SEARCH_EXPIRED'
]);
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
  if(['SESSION_REQUIRED','SKILL_AUTH_REQUIRED'].includes(code)){
    message='An authorized Plaza session is required for private account operations.';
    next='Run node /absolute/skill/scripts/plaza-basic.mjs login in your own terminal. Do not paste credentials into chat.';
  }else if(['HUMAN_TERMINAL_REQUIRED','LOGIN_CANCELLED','SESSION_STORE_UNSAFE','INVALID_SESSION'].includes(code)){
    message='Login needs a human terminal and private local session storage.';
    next='Run login yourself in a terminal; do not send credentials to the Agent. Preserve existing files if the session directory is unsafe.';
  }else if(['SEARCH_CURSOR_REQUIRED','SKILL_SEARCH_CURSOR_INVALID','SKILL_SEARCH_EXPIRED'].includes(code)){
    message='This search continuation is invalid or expired.';
    next='Use only the returned next_cursor within one hour, without changing filters. Start a new search if it expired; a new search uses one search allowance.';
  }else if(['SKILL_SERVICE_UNAVAILABLE','SKILL_AUTH_UNAVAILABLE','SKILL_ADMISSION_UNAVAILABLE',
      'SKILL_WORKER_UNAVAILABLE','SKILL_WORKER_FAILED','SKILL_WORKER_TIMEOUT','SKILL_SERVICE_FAILED',
      'SKILL_EXECUTION_UNAVAILABLE','SKILL_DEPENDENCY_UNAVAILABLE','SKILL_RESULT_INVALID',
      'SKILL_INTERNAL_ERROR','SKILL_ROUTE_NOT_FOUND','SKILL_SITE_ASSETS_UNAVAILABLE',
      'SKILL_ASSET_INVALID','SKILL_ASSET_CHANGED','SKILL_ASSET_INTEGRITY'].includes(code)){
    message='The private creative service is unavailable or not configured.';
    next='Keep your input and request ID. Retry manually only after the service is ready; this failure is not a completed draft.';
    retryable=true;
  }else if(['SKILL_AUTH_TIMEOUT','SKILL_ADMISSION_TIMEOUT','SKILL_READ_TIMEOUT','SKILL_REQUEST_ABORTED'].includes(code)){
    message='The private creative request timed out or was interrupted; completion is unconfirmed.';
    next='Keep the same input and request ID. Check the service or account state before a manual retry; do not submit a replacement task automatically.';
    retryable=true;
  }else if(['SKILL_QUOTA_EXCEEDED','SKILL_QUOTA_EXHAUSTED'].includes(code)){
    message='The account allowance for this operation has been reached.';
    next='Run usage to check the separate account allowances and reset time; do not loop requests or change accounts to bypass it.';
  }else if(['SKILL_REQUEST_PENDING','SKILL_REQUEST_UNKNOWN'].includes(code)){
    message='The original request is pending or its outcome is unconfirmed.';
    next='Keep the original input and request ID. Run status REQUEST_ID; do not create a replacement task or release its reservation locally.';
  }else if(code==='SKILL_REQUEST_NOT_FOUND'){
    message='No request receipt was found for this signed-in account.';
    next='Check the original request ID and account. Do not infer another account has no task.';
  }else if(code==='SKILL_RECEIPT_LIMIT'){
    message='The service request safety limit has been reached.';
    next='Keep existing request IDs for status or replay. This safety limit does not unlock different features for another plan.';
  }else if(code==='SKILL_ORIGIN_DENIED'){
    message='The account request source was not accepted.';
    next='Use the official site or authorized client session; do not bypass its source checks.';
  }else if(code==='SKILL_BUSY'){
    message='The creative service is busy.';
    next='Retry manually later with the same request ID and unchanged input.';retryable=true;
  }else if(code==='SKILL_REQUEST_CONFLICT'){
    message='This request ID is already associated with different input.';
    next='Restore the original input for that ID. Use a new ID only when you intentionally start a different task.';
  }else if(['SKILL_CASE_UNAVAILABLE','SKILL_RECIPE_NOT_FOUND'].includes(code)){
    message='This case or recipe is currently unavailable.';
    next='Choose a currently available source or use text you have permission to adapt. Do not restore a delisted source.';
  }else if(['SKILL_ASSET_INPUT_INVALID','SKILL_RECIPE_INPUT_INVALID'].includes(code)){
    message='The case selection or recipe inputs are invalid.';
    next='Use an actual returned case/recipe ID, a route from that recipe and its declared slot names.';
  }else if(code==='SOURCE_PROMPT_MISSING'){
    message='The selected source text is missing or empty.';
    next='Read the authorized complete source or provide your own text; do not reconstruct a missing original.';
  }else if(code==='SOURCE_PROMPT_TOO_LARGE'){
    message='The source text exceeds the 64 KiB UTF-8 limit.';
    next='Keep the complete original. Ask the user to select a shorter authorized input; do not silently truncate it.';
  }else if(code.startsWith('CREATIVE_')||code==='REQUEST_ID_REQUIRED'||code.startsWith('SKILL_INPUT_')||
      ['SKILL_BODY_TOO_LARGE','SKILL_REQUEST_TOO_LARGE','SKILL_INVALID_INPUT','SKILL_INVALID_REQUEST_ID',
       'SKILL_UNSUPPORTED_OPERATION','SKILL_UNKNOWN_OPERATION','SKILL_OUTPUT_TOO_LARGE',
       'SKILL_JSON_REQUIRED','SKILL_JSON_INVALID','SKILL_SCHEMA_INVALID','SKILL_OPERATION_INVALID',
       'SKILL_REQUEST_ID_INVALID','SKILL_METHOD_NOT_ALLOWED','SPEC_TOO_LARGE'].includes(code)){
    message='The creative request is invalid or exceeds a supported boundary.';
    next='Use one documented operation, bounded JSON on stdin and a stable 16–128 character request ID. Keep account IDs and secrets out of the payload.';
  }else if(['API_HTTP_401','API_HTTP_403'].includes(code)){
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
    message='The output path cannot be used.';next='Choose an existing private directory and a new absolute file path outside both the current working directory (including its descendants) and the installed Skill directory.';
  }else if(['UNTRUSTED_SESSION_ORIGIN','UNTRUSTED_API_ORIGIN','HTTPS_REQUIRED','INVALID_API_ORIGIN','INVALID_SESSION'].includes(code)){
    message='The API or session configuration was rejected.';next='Use the official HTTPS API and an existing supported authorized session. Keep credentials out of chat.';
  }else if(code==='API_SEARCH_CONTRACT_INVALID'){
    message='The service returned an invalid search response.';
    next='Keep your search terms and retry manually later; an invalid response does not mean no matching cases exist.';
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
  if (!['search','get','download','capabilities','creative','usage','status','login','logout'].includes(action)) throw failure('UNKNOWN_COMMAND');
  const pos=[],opt={};
  const allowed=action==='search'?FILTERS:action==='download'?new Set(['output']):action==='creative'?new Set(['input','request-id']):new Set();
  for(let i=0;i<rest.length;i++) {
    if(!rest[i].startsWith('--')) {pos.push(rest[i]);continue;}
    const key=rest[i].slice(2);
    if(!allowed.has(key)||Object.hasOwn(opt,key)) throw failure('INVALID_OPTION');
    const value=rest[++i];if(!value||value.startsWith('--'))throw failure('OPTION_VALUE_REQUIRED');
    opt[key]=value;
  }
  return {action,pos,opt};
}
function apiContext(env, requireSession = false) {
  const origin=originOf(env.PROMPTPLAZA_API_BASE||DEFAULT_API);
  const token=env.PROMPTPLAZA_TOKEN||'';
  if(typeof token!=='string'||token.length>4096||/\s/.test(token)) throw failure('INVALID_SESSION');
  if(token&&!origin.local&&!OFFICIAL_API_ORIGINS.has(origin.url))throw failure('UNTRUSTED_SESSION_ORIGIN');
  if(!origin.local&&!OFFICIAL_API_ORIGINS.has(origin.url))throw failure('UNTRUSTED_API_ORIGIN');
  if(requireSession&&!token)throw failure('SESSION_REQUIRED');
  const headers={Accept:'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  return {origin,headers};
}
async function readChunk(reader,signal) {
  if(signal.aborted)throw failure('API_TIMEOUT');
  let listener;
  const aborted=new Promise((_,reject)=>{
    listener=()=>reject(failure('API_TIMEOUT'));
    signal.addEventListener('abort',listener,{once:true});
  });
  try{return await Promise.race([reader.read(),aborted]);}
  finally{signal.removeEventListener('abort',listener);}
}
async function requestJson(path, fetchImpl, env, {method='GET',body,requestId,service=false,unauthenticated=false}={}) {
  const {origin,headers}=apiContext(env,method==='POST'&&!unauthenticated);
  if(method==='POST'){
    headers['Content-Type']='application/json';
    if(requestId)headers['Idempotency-Key']=requestId;
  }
  let response;
  const signal=AbortSignal.timeout(15000);
  try {
    response=await fetchImpl(origin.url+path,{
      method,headers,redirect:'error',signal,...(body===undefined?{}:{body})
    });
  } catch(e) { throw failure(signal.aborted||['AbortError','TimeoutError'].includes(e?.name)?'API_TIMEOUT':'API_REQUEST_FAILED'); }
  if(!response||!Number.isInteger(response.status))throw failure('API_RESPONSE_INVALID');
  if(!response.ok&&!service)throw failure('API_HTTP_'+response.status);
  if(typeof response.body?.getReader!=='function')throw failure('API_RESPONSE_INVALID');
  const reader=response.body.getReader(),chunks=[];
  let bytes=0;
  try{
    while(true){
      const {done,value}=await readChunk(reader,signal);if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_JSON_BYTES)throw failure('API_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  }catch(e){
    // Cancellation must not wait for a broken upstream to acknowledge it.
    reader.cancel().catch(()=>{});
    if(['API_RESPONSE_TOO_LARGE','API_TIMEOUT'].includes(e?.code))throw e;
    throw failure(signal.aborted||['AbortError','TimeoutError'].includes(e?.name)?'API_TIMEOUT':'API_READ_FAILED');
  }finally{reader.releaseLock();}
  let parsed;
  try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{
    if(!response.ok)throw failure(service&&response.status===404?'SKILL_SERVICE_UNAVAILABLE':'API_HTTP_'+response.status);
    throw failure('API_JSON_INVALID');
  }
  if(!response.ok){
    const code=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed.error:null;
    if(service&&SERVICE_ERRORS.has(code))throw failure(code);
    throw failure(service&&response.status===404?'SKILL_SERVICE_UNAVAILABLE':'API_HTTP_'+response.status);
  }
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw failure('API_RESPONSE_INVALID');
  if(parsed.ok===false)throw failure(service&&SERVICE_ERRORS.has(parsed.error)?parsed.error:'API_REPORTED_FAILURE');
  return parsed;
}
const getJson=(path,fetchImpl,env)=>requestJson(path,fetchImpl,env);
async function stdinJson() {
  const chunks=[];let bytes=0;
  const signal=AbortSignal.timeout(15000);
  const input=process.stdin;
  const reader=input[Symbol.asyncIterator]();
  let listener;
  const aborted=new Promise((_,reject)=>{
    listener=()=>{input.pause();reject(failure('CREATIVE_INPUT_TIMEOUT'));};
    signal.addEventListener('abort',listener,{once:true});
  });
  try{
    while(true){
      const {done,value}=await Promise.race([reader.next(),aborted]);
      if(done)break;
      bytes+=Buffer.byteLength(value);
      if(bytes>MAX_CREATIVE_BYTES){input.pause();throw failure('CREATIVE_INPUT_TOO_LARGE');}
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }finally{
    signal.removeEventListener('abort',listener);
    // This command is the sole owner of CLI stdin; it never consumes it for reads/help.
    input.destroy();
  }
}
async function creativeInput(input) {
  const raw=input===undefined?await stdinJson():input;
  if(typeof raw!=='string'&&!Buffer.isBuffer(raw)&&!(raw instanceof Uint8Array))throw failure('CREATIVE_INPUT_INVALID');
  if(Buffer.byteLength(raw)>MAX_CREATIVE_BYTES)throw failure('CREATIVE_INPUT_TOO_LARGE');
  let value;
  try{value=JSON.parse(typeof raw==='string'?raw:new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw failure('CREATIVE_INPUT_INVALID');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw failure('CREATIVE_INPUT_INVALID');
  return value;
}
function projectCapabilities(body) {
  if(body.ok!==true||body.schema!=='promptplaza-skill-capabilities-v1'||
      !Array.isArray(body.operations)||body.operations.length>64||
      new Set(body.operations).size!==body.operations.length||
      body.operations.some(x=>typeof x!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(x))||
      body.same_features_for_all_plans!==true||body.execution!=='NOT_RUN'||
      body.requires_session_for_creative!==true||typeof body.admission_configured!=='boolean'||
      !Array.isArray(body.packs)||body.packs.length<1||body.packs.length>32||
      new Set(body.packs.map(x=>x?.id)).size!==body.packs.length||
      body.packs.some(x=>!x||typeof x!=='object'||Array.isArray(x)||
        typeof x.id!=='string'||!/^[-a-z0-9]{1,64}$/.test(x.id)||
        typeof x.title!=='string'||!x.title.trim()||x.title.length>160||!['image','video'].includes(x.medium)))
    throw failure('API_SKILL_CONTRACT_INVALID');
  return {ok:true,schema:body.schema,operations:body.operations.filter(x=>CREATIVE_OPERATIONS.includes(x)),
    unavailable_operations:CREATIVE_OPERATIONS.filter(x=>!body.operations.includes(x)),same_features_for_all_plans:true,
    packs:body.packs.map(({id,title,medium})=>({id,title,medium})),requires_session_for_creative:true,
    admission_configured:body.admission_configured,
    site_assets_configured:body.site_assets_configured===true,execution:'NOT_RUN',generation_calls:0};
}
function projectUsage(body) {
  const validCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000;
  if(body.ok!==true||body.schema!=='promptplaza-skill-usage-v1'||body.execution!=='NOT_RUN'||
      !['free','member'].includes(body.tier)||body.timezone!=='Asia/Shanghai'||
      typeof body.policy_version!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(body.policy_version)||
      typeof body.quota_day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.quota_day)||
      typeof body.resets_at!=='string'||body.resets_at.length>40||!Number.isFinite(Date.parse(body.resets_at))||
      !['search','creative'].every(key=>{
        const v=body.buckets?.[key];return v&&['limit','used','reserved','remaining'].every(k=>validCount(v[k]))&&
          v.remaining===Math.max(0,v.limit-v.used-v.reserved);
      }))throw failure('API_SKILL_CONTRACT_INVALID');
  return {ok:true,schema:body.schema,tier:body.tier,policy_version:body.policy_version,quota_day:body.quota_day,
    timezone:body.timezone,resets_at:body.resets_at,buckets:Object.fromEntries(['search','creative'].map(key=>{
      const {limit,used,reserved,remaining}=body.buckets[key];return [key,{limit,used,reserved,remaining}];
    })),execution:'NOT_RUN',generation_calls:0};
}
function projectRequestStatus(body, requestId) {
  if(body.ok!==true||body.schema!=='promptplaza-skill-request-status-v1'||body.execution!=='NOT_RUN'||
      body.request_id!==requestId||!['PENDING','COMPLETED','FAILED','UNKNOWN'].includes(body.state)||
      typeof body.operation!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(body.operation)||
      !(body.bucket===null||['search','creative'].includes(body.bucket))||
      typeof body.quota_day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.quota_day)||
      typeof body.policy_version!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(body.policy_version)||
      !['created_at','updated_at'].every(key=>typeof body[key]==='string'&&body[key].length<=40&&Number.isFinite(Date.parse(body[key]))))
    throw failure('API_SKILL_CONTRACT_INVALID');
  const {schema,request_id,operation,state,bucket,quota_day,policy_version,created_at,updated_at}=body;
  return {ok:true,schema,request_id,operation,state,bucket,quota_day,policy_version,created_at,updated_at,execution:'NOT_RUN',generation_calls:0};
}
function projectCreative(body,operation) {
  if(body.ok!==true||body.schema!=='promptplaza-skill-result-v1'||body.operation!==operation||
      !body.result||typeof body.result!=='object'||Array.isArray(body.result)||body.execution!=='NOT_RUN')
    throw failure('API_SKILL_CONTRACT_INVALID');
  return {ok:true,schema:body.schema,operation,result:body.result,execution:'NOT_RUN',
    ...(['case-ideas','recipe-catalog'].includes(operation)||operation.startsWith('interview-')?{}:
      {draft_status:'DRAFT_NOT_RUN'}),generation_calls:0};
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
  if(!Array.isArray(body.items))throw failure('API_SEARCH_CONTRACT_INVALID');
  const metadata=(value,max)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):null;
  const durationTags=value=>Array.isArray(value)?[...new Set(value
    .filter(x=>typeof x==='string'&&x.trim()&&x.length<=80).map(x=>x.trim()))].slice(0,8):[];
  const rows=body.items.slice(0,limit);
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
export async function execute(argv,{env=process.env,fetchImpl=fetch,cwd=process.cwd(),input,credentials,sessionStore}={}){
  const {action,pos,opt}=options(argv);
  if(action==='help')return {commands:['search [TOPIC] [--author HANDLE] [--duration TAG] [--kind image|video] [--limit 1..20]',
    'get CASE_ID','download CASE_ID --output /absolute/new/file.txt','capabilities','usage','status REQUEST_ID',
    'creative OPERATION --input - --request-id 16..128-safe-characters','login','logout'],
    creative_operations:[...CREATIVE_OPERATIONS],source:'authorized Plaza API; private creative service required',
    creative_service_status:'FREE_ACCOUNT_SERVICE',free_daily:{creative:10,search:50},
    pagination:'search --cursor TOKEN (up to 5 pages; no extra search debit)',generation_calls:0};
  if(action==='login'){
    if(pos.length||!sessionStore||typeof credentials?.email!=='string'||typeof credentials?.password!=='string'||
       credentials.email.length>254||credentials.password.length<8||credentials.password.length>72)throw failure('HUMAN_TERMINAL_REQUIRED');
    const origin=apiContext(env).origin;
    if(origin.url!==DEFAULT_API)throw failure('UNTRUSTED_SESSION_ORIGIN');
    const result=await requestJson('/v1/verify',fetchImpl,{}, {method:'POST',unauthenticated:true,
      body:JSON.stringify({email:credentials.email,password:credentials.password})});
    if(typeof result.token!=='string'||! /^[A-Za-z0-9_-]{8,256}$/.test(result.token))throw failure('INVALID_SESSION');
    await sessionStore.write({schema:'promptplaza-session-v1',origin:origin.url,token:result.token,created_at:Date.now()});
    return {ok:true,authenticated:true,session_saved:true,password_saved:false,token_displayed:false,generation_calls:0};
  }
  if(action==='logout'){
    if(pos.length||!sessionStore)throw failure('INVALID_OPTION');
    let revoked=false;
    try{apiContext(env,true);await requestJson('/v1/logout',fetchImpl,env,{method:'POST',body:'{}'});revoked=true;}
    catch{ /* Local logout must still remove a stale session if the network is unavailable. */ }
    await sessionStore.clear();
    return {ok:true,local_session_removed:true,server_session_revoked:revoked,generation_calls:0};
  }
  if(action==='capabilities'){
    if(pos.length)throw failure('INVALID_OPTION');
    return projectCapabilities(await requestJson('/v1/skill/capabilities',fetchImpl,env,{service:true}));
  }
  if(action==='usage'||action==='status'){
    if(action==='usage'&&pos.length||action==='status'&&(pos.length!==1||!REQUEST_ID.test(pos[0])))throw failure('INVALID_OPTION');
    apiContext(env,true);
    const body=await requestJson(action==='usage'?'/v1/skill/usage':'/v1/skill/requests/'+encodeURIComponent(pos[0]),fetchImpl,env,{service:true});
    return action==='usage'?projectUsage(body):projectRequestStatus(body,pos[0]);
  }
  if(action==='creative'){
    if(pos.length!==1||!CREATIVE_OPERATIONS.includes(pos[0]))throw failure('CREATIVE_OPERATION_INVALID');
    if(opt.input!=='-')throw failure('CREATIVE_STDIN_REQUIRED');
    if(typeof opt['request-id']!=='string'||!REQUEST_ID.test(opt['request-id']))throw failure('REQUEST_ID_REQUIRED');
    // Validate destination and existing session before reading potentially private stdin.
    apiContext(env,true);
    const operation=pos[0],payload=await creativeInput(input);
    const body=JSON.stringify({schema:'promptplaza-skill-request-v1',operation,input:payload});
    if(Buffer.byteLength(body)>MAX_CREATIVE_BYTES)throw failure('CREATIVE_INPUT_TOO_LARGE');
    return projectCreative(await requestJson('/v1/skill/creative',fetchImpl,env,
      {method:'POST',body,requestId:opt['request-id'],service:true}),operation);
  }
  if(action==='search'){
    apiContext(env,true);
    if(opt.cursor!==undefined){
      if(pos.length||Object.keys(opt).some(key=>key!=='cursor')||!opt.cursor||opt.cursor.length>4096)throw failure('SEARCH_FILTER_INVALID');
      const result=await requestJson('/v1/skill/search',fetchImpl,env,{method:'POST',body:JSON.stringify({cursor:opt.cursor}),service:true});
      return projectMeteredSearch(result,20);
    }
    const query=pos.join(' ').trim();
    const author=opt.author===undefined?undefined:opt.author.trim().replace(/^@/,'').trim();
    if((!query&&author===undefined)||query.length>200)throw failure('SEARCH_QUERY_INVALID');
    if(opt.kind&&!['image','video'].includes(opt.kind))throw failure('SEARCH_KIND_INVALID');
    const limit=integer(opt.limit,8,1,20),offset=integer(opt.offset,0,0,10000);
    if(offset!==0)throw failure('SEARCH_CURSOR_REQUIRED');
    const q=new URLSearchParams({q:query,limit:String(limit),offset:String(offset)});
    for(const key of ['kind','category','model','style','aspect','author','duration']){
      if(opt[key]===undefined)continue;
      const value=key==='author'?author:opt[key];
      if(!value.trim()||value.length>80||/[\u0000-\u001f\u007f]/.test(value))throw failure('SEARCH_FILTER_INVALID');
      q.set(key,value);
    }
    const requestId=opt['request-id']||randomUUID();
    if(!REQUEST_ID.test(requestId))throw failure('REQUEST_ID_REQUIRED');
    const body=Object.fromEntries(q);delete body.offset;body.limit=limit;
    try{return projectMeteredSearch(await requestJson('/v1/skill/search',fetchImpl,env,
      {method:'POST',body:JSON.stringify(body),requestId,service:true}),limit);}
    catch(error){error.request_id=requestId;throw error;}
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
function projectMeteredSearch(body,limit){
  if(body.schema!=='promptplaza-skill-search-v1'||!REQUEST_ID.test(body.request_id||'')||
    !(body.next_cursor===null||typeof body.next_cursor==='string'&&body.next_cursor.length<=4096)||
    !Number.isInteger(body.page)||body.page<0||body.page>=5)throw failure('API_SEARCH_CONTRACT_INVALID');
  return {...projectSearch(body,limit),request_id:body.request_id,page:body.page,next_cursor:body.next_cursor,
    cursor_expires_at:text(body.cursor_expires_at,40),page_limit:5};
}

// Session storage is separate from the open Skill and every project checkout.
export function createSessionStore(directory){
  const dir=resolve(directory),file=resolve(dir,'session.json');
  async function guard(create=false){
    if(create)await mkdir(dir,{recursive:true,mode:0o700});
    let path=dir;
    while(true){
      const st=await lstat(path);
      if(st.isSymbolicLink()||!st.isDirectory())throw failure('SESSION_STORE_UNSAFE');
      if(path===dir&&((st.mode&0o077)!==0||typeof process.getuid==='function'&&st.uid!==process.getuid()))throw failure('SESSION_STORE_UNSAFE');
      const next=dirname(path);if(next===path)break;path=next;
    }
  }
  return {
    async read(){
      let handle;
      try{
        await guard();handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
        const st=await handle.stat();
        if(!st.isFile()||(st.mode&0o077)!==0||st.size>4096||typeof process.getuid==='function'&&st.uid!==process.getuid())throw failure('SESSION_STORE_UNSAFE');
        const value=JSON.parse(await handle.readFile('utf8'));
        if(value.schema!=='promptplaza-session-v1'||value.origin!==DEFAULT_API||
          !/^[A-Za-z0-9_-]{8,256}$/.test(value.token||'')||!Number.isSafeInteger(value.created_at)||
          value.created_at>Date.now()||Date.now()-value.created_at>8*3600000)return null;
        return value.token;
      }catch(error){if(error.code==='ENOENT')return null;if(error.code==='SESSION_STORE_UNSAFE')throw error;throw failure('INVALID_SESSION');}
      finally{await handle?.close();}
    },
    async write(value){
      await guard(true);
      const temporary=resolve(dir,'session-'+randomUUID()+'.tmp');let handle;
      try{handle=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW||0),0o600);
        await handle.writeFile(JSON.stringify(value));await handle.sync();await handle.close();handle=null;await rename(temporary,file);}
      finally{await handle?.close();await unlink(temporary).catch(()=>{});}
    },
    async clear(){try{await guard();await unlink(file);}catch(error){if(error.code!=='ENOENT')throw error;}},
  };
}
async function terminalCredentials(){
  if(!process.stdin.isTTY||!process.stderr.isTTY)throw failure('HUMAN_TERMINAL_REQUIRED');
  const line=createInterface({input:process.stdin,output:process.stderr});
  const email=(await line.question('PromptPlaza email: ')).trim();line.close();
  process.stderr.write('Password (hidden): ');
  const password=await new Promise((accept,reject)=>{
    let value='';process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.resume();
    const finish=(error)=>{process.stdin.off('data',read);process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');error?reject(error):accept(value);};
    const read=chunk=>{for(const ch of chunk){if(ch==='\u0003'){finish(failure('LOGIN_CANCELLED'));return;}
      if(ch==='\r'||ch==='\n'){finish();return;}if(ch==='\u007f'||ch==='\b'){value=value.slice(0,-1);continue;}
      if(ch>=' '&&ch!=='\u007f')value+=ch;if(value.length>72){finish(failure('INVALID_SESSION'));return;}}};
    process.stdin.on('data',read);
  });
  return {email,password};
}
async function main(){
  const args=process.argv.slice(2),env={...process.env};
  const stateDirectory=env.PROMPTPLAZA_STATE_DIR||resolve(homedir(),'.local/state/promptplaza');
  const blockedRoots=[SKILL_ROOT,...(env.PROMPTPLAZA_STATE_DIR?[resolve(process.cwd())]:[])];
  if(!isAbsolute(stateDirectory)||blockedRoots.some(root=>resolve(stateDirectory)===root||resolve(stateDirectory).startsWith(root+sep)))throw failure('SESSION_STORE_UNSAFE');
  const sessionStore=createSessionStore(stateDirectory);
  if(args[0]&&!['login','help','--help','capabilities'].includes(args[0])&&!env.PROMPTPLAZA_TOKEN)env.PROMPTPLAZA_TOKEN=await sessionStore.read()||'';
  return execute(args,{env,sessionStore,...(args[0]==='login'?{credentials:await terminalCredentials()}:{} )});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main()
    .then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n'))
    .catch(error=>{
      process.stderr.write(JSON.stringify({...explainFailure(error),...(REQUEST_ID.test(error.request_id||'')?{request_id:error.request_id}:{})})+'\n');
      process.exitCode=2;
    });
}
