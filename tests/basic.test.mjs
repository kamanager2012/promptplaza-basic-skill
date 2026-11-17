// SPDX-License-Identifier: Apache-2.0
// Synthetic, offline and limited. Never contacts PromptPlaza or a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execute, explainFailure, originOf, projectCase, createSessionStore } from '../scripts/plaza-basic.mjs';

const usageBody = () => ({ok:true,schema:'promptplaza-skill-usage-v1',tier:'free',policy_version:'fixture-v1',
  quota_day:'2026-11-17',timezone:'Asia/Shanghai',resets_at:'2026-11-17T16:00:00.000Z',
  buckets:{search:{limit:2,used:1,reserved:0,remaining:1},creative:{limit:2,used:0,reserved:1,remaining:1}},execution:'NOT_RUN'});
test('login uses official password endpoint, stores only session and never projects credentials',async()=>{
  let stored;
  const api=fake({ok:true,token:'synthetic-session',userId:'fixture-user'});
  const out=await execute(['login'],{env:{},fetchImpl:api.call,credentials:{email:'fixture@example.invalid',password:'Synthetic123'},
    sessionStore:{write:async value=>{stored=value;}}});
  assert.equal(api.requests[0].url,'https://www.promptplaza.cn/v1/verify');
  assert.equal(api.requests[0].auth,undefined);assert.equal(stored.token,'synthetic-session');
  assert.doesNotMatch(JSON.stringify(out),/Synthetic123|synthetic-session|fixture@example/);
  assert.equal(stored.password,undefined);
  await assert.rejects(execute(['login'],{env:{},fetchImpl:api.call}),{code:'HUMAN_TERMINAL_REQUIRED'});
});
test('local logout clears stale credentials even when server revocation cannot be confirmed',async()=>{
  let cleared=0;
  const out=await execute(['logout'],{env:{PROMPTPLAZA_TOKEN:'synthetic-session'},fetchImpl:async()=>{throw new Error('offline');},
    sessionStore:{clear:async()=>cleared++}});
  assert.equal(cleared,1);assert.equal(out.server_session_revoked,false);assert.equal(out.local_session_removed,true);
});
test('session store uses private permissions, rejects symlinks and forgets expired tokens',async()=>{
  const root=await mkdtemp(join(tmpdir(),'plaza-session-'));
  try{
    const path=join(root,'private'),store=createSessionStore(path);
    const value={schema:'promptplaza-session-v1',origin:'https://www.promptplaza.cn',token:'synthetic-session',created_at:Date.now()};
    await store.write(value);assert.equal(await store.read(),'synthetic-session');
    assert.equal((await stat(join(path,'session.json'))).mode&0o777,0o600);
    await store.write({...value,created_at:Date.now()-9*3600000});assert.equal(await store.read(),null);
    await store.clear();assert.equal(await store.read(),null);
    await symlink(path,join(root,'linked'));await assert.rejects(createSessionStore(join(root,'linked')).write(value),{code:'SESSION_STORE_UNSAFE'});
  }finally{await rm(root,{recursive:true,force:true});}
});
test('new search requires account, zero offset and a stable key; continuation keeps its opaque cursor',async()=>{
  let calls=0;
  await assert.rejects(execute(['search','cup'],{env:{},fetchImpl:async()=>calls++}),{code:'SESSION_REQUIRED'});
  assert.equal(calls,0);
  await assert.rejects(run(['search','cup','--offset','8'],fake({items:[]})),{code:'SEARCH_CURSOR_REQUIRED'});
  const api=fake({schema:'promptplaza-skill-search-v1',request_id:'search-request-00000001',items:[],total:0,page:1,next_cursor:null});
  await run(['search','--cursor','opaque.signed'],api);
  assert.deepEqual(JSON.parse(api.requests[0].body),{cursor:'opaque.signed'});
  assert.equal(api.requests[0].requestId,undefined);
});
test('usage uses authenticated read-only request and projects independent counters', async()=>{
  const body=usageBody();body.private_database='DO_NOT_PROJECT';
  const api=fake(body),env={PROMPTPLAZA_TOKEN:'synthetic-session'};
  const value=await execute(['usage'],{env,fetchImpl:api.call});
  assert.equal(api.requests.length,1);assert.equal(api.requests[0].method,'GET');
  assert.equal(api.requests[0].url,'https://www.promptplaza.cn/v1/skill/usage');
  assert.equal(api.requests[0].auth,'Bearer synthetic-session');
  assert.deepEqual(value.buckets,body.buckets);assert.ok(!JSON.stringify(value).includes('DO_NOT_PROJECT'));
});
test('private usage and receipt reads require existing session before fetching', async()=>{
  for(const args of [['usage'],['status','request-0000000001']]){
    let calls=0;await assert.rejects(execute(args,{env:{},fetchImpl:async()=>{calls++;}}),error=>error.code==='SESSION_REQUIRED');
    assert.equal(calls,0);
  }
});
test('usage rejects inconsistent counts and wrong contracts', async()=>{
  for(const body of [{...usageBody(),timezone:'UTC'},{...usageBody(),tier:'administrator'},
    {...usageBody(),buckets:{...usageBody().buckets,creative:{limit:2,used:0,reserved:1,remaining:2}}}]){
    await assert.rejects(execute(['usage'],{env:{PROMPTPLAZA_TOKEN:'synthetic-session'},fetchImpl:fake(body).call}),error=>error.code==='API_SKILL_CONTRACT_INVALID');
  }
});
test('status returns only the requested receipt metadata and never its prompt result', async()=>{
  const body={ok:true,schema:'promptplaza-skill-request-status-v1',request_id:'request-0000000001',
    operation:'compile',state:'COMPLETED',bucket:'creative',quota_day:'2026-11-17',policy_version:'fixture-v1',
    created_at:'2026-11-17T03:00:00.000Z',updated_at:'2026-11-17T03:00:01.000Z',
    result:{prompt:'DO_NOT_PROJECT'},execution:'NOT_RUN'};
  const api=fake(body),env={PROMPTPLAZA_TOKEN:'synthetic-session'};
  const value=await execute(['status',body.request_id],{env,fetchImpl:api.call});
  assert.equal(value.state,'COMPLETED');assert.ok(!JSON.stringify(value).includes('DO_NOT_PROJECT'));
  assert.ok(api.requests[0].url.endsWith('/v1/skill/requests/'+body.request_id));
  await assert.rejects(execute(['status','request-0000000002'],{env,fetchImpl:fake(body).call}),error=>error.code==='API_SKILL_CONTRACT_INVALID');
});
test('unknown and pending receipts retain recovery guidance without automatic retry', async()=>{
  for(const code of ['SKILL_REQUEST_UNKNOWN','SKILL_REQUEST_PENDING','SKILL_REQUEST_NOT_FOUND','SKILL_RECEIPT_LIMIT','SKILL_ORIGIN_DENIED']){
    const api=fake({ok:false,error:code,execution:'NOT_RUN'},409);
    await assert.rejects(execute(['status','request-0000000001'],{env:{PROMPTPLAZA_TOKEN:'synthetic-session'},fetchImpl:api.call}),error=>error.code===code);
    assert.equal(api.requests.length,1);
    assert.ok(explainFailure({code}).next_step.length>20);
  }
  assert.match(explainFailure({code:'SKILL_REQUEST_UNKNOWN'}).next_step,/status REQUEST_ID/);
});

function fake(body, status = 200) {
  const requests = [];
  return { requests, call: async (url, init) => {
    requests.push({ url: String(url), method: init.method, auth: init.headers.Authorization, redirect: init.redirect, body:init.body,requestId:init.headers['Idempotency-Key'],signal:init.signal });
    let value=body;
    if(String(url).endsWith('/v1/skill/search')&&status===200&&body&&typeof body==='object'&&!Array.isArray(body)&&Array.isArray(body.items)){
      value={schema:'promptplaza-skill-search-v1',request_id:init.headers['Idempotency-Key']||'search-request-00000001',page:0,next_cursor:null,cursor_expires_at:'2026-11-17T16:00:00Z',total:body.items.length,...body};
    }
    return new Response(JSON.stringify(value),{status});
  }};
}
function caseBody(data = {}) {
  const item={
    id: 'case-1', kind: 'image', title: 'Synthetic Case',
    prompt_status: 'full', prompt: 'Complete, original prompt.\nSecond line.',
    copyable: true, rights: { license: 'NOASSERTION' }, ...data
  };
  if(!Object.hasOwn(data,'prompt_sha256'))item.prompt_sha256=typeof item.prompt==='string'?
    createHash('sha256').update(item.prompt,'utf8').digest('hex'):null;
  if(!Object.hasOwn(data,'prompt_bytes'))item.prompt_bytes=typeof item.prompt==='string'?
    Buffer.byteLength(item.prompt,'utf8'):null;
  return {ok:true,schema:'promptplaza-public-source-v1',source:'authorized-public-copy-v1',case:item};
}
const run = (args, mock, env = {}, opts = {}) =>
  execute(args, { fetchImpl: mock.call, env:args[0]==='search'?{PROMPTPLAZA_TOKEN:'synthetic-session',...env}:env, ...opts });

test('explicit official HTTPS origin and localhost are accepted', () => {
  assert.equal(originOf('https://www.promptplaza.cn').url, 'https://www.promptplaza.cn');
  assert.equal(originOf('http://127.0.0.1:8790').local, true);
});
test('remote plaintext HTTP and credentials in API origin are rejected', () => {
  assert.throws(() => originOf('http://example.org'), { code: 'HTTPS_REQUIRED' });
  assert.throws(() => originOf('https://user:pass@example.org'), { code: 'INVALID_API_ORIGIN' });
});
test('search only exposes bounded metadata; a listing prompt cannot leak', async () => {
  const items = Array.from({ length: 25 }, (_, i) => ({
    id: 'case-' + i, title: 'Fixture ' + i, kind: 'image',
    prompt: 'THIRD_PARTY_ORIGINAL_NOT_FOR_LISTING', prompt_status: 'excerpt'
  }));
  const m = fake({ items, total: 25, next_offset: 20 });
  const out = await run(['search', 'still life', '--limit', '20', '--kind', 'image'], m);
  assert.equal(out.items.length, 20);
  assert.equal(out.items[0].prompt_available_in_listing, false);
  assert.doesNotMatch(JSON.stringify(out), /THIRD_PARTY_ORIGINAL/);
  assert.equal(m.requests.length, 1);
  assert.equal(m.requests[0].url, 'https://www.promptplaza.cn/v1/skill/search');
  assert.equal(JSON.parse(m.requests[0].body).limit,20);
  assert.equal(m.requests[0].method,'POST');
  assert.equal(m.requests[0].redirect, 'error');
});
test('search validates limits and filters before HTTP', async () => {
  const m = fake({ items: [] });
  await assert.rejects(run(['search', 'flower', '--limit', '21'], m), { code: 'INVALID_INTEGER' });
  await assert.rejects(run(['search', 'flower', '--kind', 'invalid'], m), { code: 'SEARCH_KIND_INVALID' });
  await assert.rejects(run(['search', 'flower', '--offset', '-1'], m), { code: 'INVALID_INTEGER' });
  assert.equal(m.requests.length, 0);
});
test('search retains author, numeric duration and evidence without promoting verification or leaking private fields', async () => {
  const m=fake({items:[{id:'case-1',kind:'video',author:' Fixture Author ',author_handle:'fixture_author',
    duration_s:20.053333,search_tags:{duration:['16-30','16-30',' ',' 31-60 ']},
    model:'fixture-model',model_evidence_scope:'source_prompt',canonical_path:'/case/case-1',
    prompt:'PRIVATE_ORIGINAL',private_recipe:'PRIVATE_RECIPE',reference_assets:['PRIVATE_MEDIA']} ]});
  const out=await run(['search','product','--kind','video'],m);
  const item=out.items[0];
  assert.equal(item.author,'Fixture Author');assert.equal(item.author_handle,'fixture_author');
  assert.equal(item.duration_s,20.053333);assert.deepEqual(item.search_tags.duration,['16-30','31-60']);
  assert.equal(item.model_evidence_scope,'source_prompt');assert.equal(item.model_execution_verified_by_skill,false);
  assert.equal(item.prompt_available_in_listing,false);
  assert.doesNotMatch(JSON.stringify(out),/PRIVATE_ORIGINAL|PRIVATE_RECIPE|PRIVATE_MEDIA/);
  assert.equal(m.requests.length,1);
});
test('missing or malformed metadata stays unknown and is never reconstructed from source links', async () => {
  const m=fake({items:[{},...['20',0,-1,null,Infinity].map(duration_s=>({duration_s,
    author:42,author_handle:['guessed'],source_url:'https://x.com/not-an-author-evidence/status/1',
    search_tags:{duration:'16-30'},model:'popular-model',model_evidence_scope:' '})),
    {author:'x'.repeat(200),author_handle:'y'.repeat(100),model_evidence_scope:'verified',
      search_tags:{duration:[null,42,{},'a'.repeat(81),...Array.from({length:12},(_,i)=>'tag-'+i)]}}]});
  const out=await run(['search','video'],m);
  for(const item of out.items.slice(0,6)){
    assert.equal(item.author,null);assert.equal(item.author_handle,null);assert.equal(item.duration_s,null);
    assert.equal(item.model_evidence_scope,null);assert.equal(item.model_execution_verified_by_skill,false);
    assert.deepEqual(item.search_tags.duration,[]);
  }
  assert.equal(out.items[6].author.length,120);assert.equal(out.items[6].author_handle.length,80);
  assert.equal(out.items[6].search_tags.duration.length,8);
  assert.equal(out.items[6].model_evidence_scope,'verified');
  assert.equal(out.items[6].model_execution_verified_by_skill,false);
});
test('author-only search can follow an actual handle without another topic or extra requests', async () => {
  const m=fake({items:[]});
  const out=await run(['search','--author',' @Fixture_Author ','--limit','3'],m);
  const q=new URLSearchParams(JSON.parse(m.requests[0].body));
  assert.equal(q.get('author'),'Fixture_Author');assert.equal(q.get('q'),'');assert.equal(q.get('limit'),'3');
  assert.deepEqual(out.items,[]);assert.equal(m.requests.length,1);
});
test('author and duration compose with existing filters using exact encoded values', async () => {
  const m=fake({items:[]});
  await run(['search','product & light','--author','@creator','--duration','16-30','--kind','video',
    '--aspect','9:16','--model','fixture-model'],m);
  const q=new URLSearchParams(JSON.parse(m.requests[0].body));
  assert.equal(q.get('q'),'product & light');assert.equal(q.get('author'),'creator');assert.equal(q.get('duration'),'16-30');
  assert.equal(q.get('kind'),'video');assert.equal(q.get('aspect'),'9:16');assert.equal(q.get('model'),'fixture-model');
  assert.equal(m.requests.length,1);
});
test('empty, excessive, control-bearing and unsupported filter options fail before HTTP', async () => {
  const m=fake({items:[]});
  for(const [key,value] of [['author',' @ '],['duration',' '],['author','x'.repeat(81)],
    ['duration','x'.repeat(81)],['author','creator\nother'],['duration','16\u000030']]){
    await assert.rejects(run(['search','product','--'+key,value],m),{code:'SEARCH_FILTER_INVALID'});
  }
  await assert.rejects(run(['search'],m),{code:'SEARCH_QUERY_INVALID'});
  await assert.rejects(run(['search','product','--camera-motion','push'],m),{code:'INVALID_OPTION'});
  assert.equal(m.requests.length,0);
});
test('get returns verbatim complete source text with unverified rights', async () => {
  const m = fake(caseBody());
  const out = await run(['get', 'case-1'], m);
  assert.equal(out.prompt, 'Complete, original prompt.\nSecond line.');
  assert.equal(out.prompt_available, true);
  assert.equal(out.rights_license, 'NOASSERTION');
  assert.equal(out.republication_authorized_by_skill, false);
  assert.equal(out.source_endpoint_available,true);
  assert.equal(out.source_prompt_sha256,caseBody().case.prompt_sha256);
  assert.equal(m.requests[0].url,'https://www.promptplaza.cn/v1/cases/case-1/prompt');
});
test('excerpt and missing statuses are not complete originals', () => {
  assert.equal(projectCase(caseBody({ prompt_status: 'excerpt' })).prompt, null);
  assert.equal(projectCase(caseBody({ prompt_status: 'missing' })).prompt_available, false);
  assert.equal(projectCase(caseBody({ prompt_status: null })).prompt, null);
});
test('translation-only fields cannot replace an original', () => {
  assert.equal(projectCase(caseBody({ prompt: undefined, prompt_zh: 'Translated wording' })).prompt, null);
});
test('explicit copy and access blocks fail closed', () => {
  assert.equal(projectCase(caseBody({ copyable: false })).prompt_available, false);
  assert.equal(projectCase({ ...caseBody(), prompt_blocked: 'login_prompt_cap' }).prompt, null);
  assert.equal(projectCase(caseBody({ copyable: undefined })).prompt, null);
});
test('API-level ok=false blocks otherwise full copyable source text', () => {
  const body = { ...caseBody(), ok: false };
  assert.equal(projectCase(body).prompt, null);
  assert.equal(projectCase(body).prompt_available, false);
  assert.equal(projectCase(caseBody({ ok: false })).prompt, null);
});
test('untrusted source URLs are discarded while safe HTTPS links remain', async () => {
  assert.equal(projectCase(caseBody({ source_url: 'javascript:alert(1)' })).source_url, null);
  assert.equal(projectCase(caseBody({ source_url: 'https://user:pass@example.org/a' })).source_url, null);
  assert.equal(projectCase(caseBody({ source_url: 'https://example.org/post/123' })).source_url,
    'https://example.org/post/123');
  const m = fake({ items: [
    { id: 'case-1', title: 'Synthetic', source_url: 'https://example.org/case' },
    { id: 'case-2', title: 'Synthetic', source_url: 'http://example.org/insecure' },
  ] });
  const result = await run(['search', 'cinematic', '--limit', '2'], m);
  assert.equal(result.items[0].source_url, 'https://example.org/case');
  assert.equal(result.items[1].source_url, null);
});
test('nested case excerpt status overrides wrapper full status', () => {
  const body = { prompt_status: 'full', prompt: 'wrapper text', ...caseBody({ prompt_status: 'excerpt' }) };
  assert.equal(projectCase(body).prompt, null);
});
test('nested canonical case original outranks card text', () => {
  const body = { prompt_status: 'full', prompt: 'wrapper preview',
    card: { prompt: 'card preview', prompt_status: 'full' },
    ...caseBody({ prompt: 'Canonical full source' }) };
  assert.equal(projectCase(body).prompt, 'Canonical full source');
});
test('nested source never borrows wrapper preview text or complete status', () => {
  const missingText={...caseBody({prompt:undefined}),prompt:'Wrapper preview'};
  assert.equal(projectCase(missingText).prompt_available,false);
  assert.equal(projectCase(missingText).prompt,null);
  const missingStatus={...caseBody({prompt_status:undefined}),prompt_status:'full'};
  assert.equal(projectCase(missingStatus).prompt,null);
  const cardOnly={ok:true,prompt_status:'full',copyable:true,
    card:caseBody().case,prompt:'Wrapper preview'};
  assert.equal(projectCase(cardOnly).prompt,null);
  assert.equal(projectCase(caseBody().case).prompt,'Complete, original prompt.\nSecond line.');
});
test('official links survive search and detail without inventing a missing route', async () => {
  const item={...caseBody().case,canonical_path:'/case/case-1',source_url:'https://example.org/original'};
  const list=await run(['search','cup'],fake({items:[item]}));
  const detail=await run(['get','case-1'],fake(caseBody(item)));
  for(const result of [list.items[0],detail]){
    assert.equal(result.canonical_path,'/case/case-1');
    assert.equal(result.case_url,'https://www.promptplaza.cn/case/case-1');
    assert.equal(result.source_url,'https://example.org/original');
  }
  const missing=projectCase(caseBody());
  assert.equal(missing.case_url,null);
  assert.equal(missing.canonical_path,null);
});
test('official URL fallback requires trusted HTTPS origin and the exact case ID', () => {
  assert.equal(projectCase(caseBody({case_url:'https://promptplaza.cn/case/case-1'})).case_url,
    'https://promptplaza.cn/case/case-1');
  for(const url of ['https://example.org/case/case-1','http://www.promptplaza.cn/case/case-1',
    'https://www.promptplaza.cn:444/case/case-1','https://user:pass@www.promptplaza.cn/case/case-1',
    'https://www.promptplaza.cn/case/other','https://www.promptplaza.cn/case/case-1?token=secret',
    'https://www.promptplaza.cn/case/case-1#fragment']){
    assert.equal(projectCase(caseBody({case_url:url})).case_url,null);
  }
  assert.equal(projectCase(caseBody({canonical_path:'/case/other',
    case_url:'https://www.promptplaza.cn/case/case-1'})).case_url,null);
});
test('unavailable sources describe access without fabricating original text', () => {
  for(const [data,access] of [[{copyable:false},'restricted'],[{prompt_status:'excerpt'},'excerpt'],
    [{prompt_status:'missing'},'missing'],[{prompt_status:undefined},'unavailable']]){
    const out=projectCase(caseBody(data));
    assert.equal(out.prompt,null);assert.equal(out.prompt_available,false);
    assert.equal(out.prompt_access,access);assert.ok(out.prompt_notice);
  }
  assert.equal(projectCase(caseBody()).prompt_access,'full');
  assert.equal(projectCase(caseBody()).prompt_notice,null);
});
test('invalid case IDs and options never fetch', async () => {
  const m = fake(caseBody());
  await assert.rejects(run(['get', '../../etc/passwd'], m), { code: 'CASE_ID_INVALID' });
  await assert.rejects(run(['get', 'case-1', '--extra', 'yes'], m), { code: 'INVALID_OPTION' });
  await assert.rejects(run(['download', 'case-1', '--output', 'relative.txt'], m), { code: 'ABSOLUTE_OUTPUT_REQUIRED' });
  assert.equal(m.requests.length, 0);
});
test('authorized session is sent only to trusted site', async () => {
  const m = fake(caseBody());
  await run(['get', 'case-1'], m, { PROMPTPLAZA_TOKEN: 'synthetic-session' });
  assert.equal(m.requests[0].auth, 'Bearer synthetic-session');
  const other = fake(caseBody());
  await assert.rejects(run(['get', 'case-1'], other, {
    PROMPTPLAZA_TOKEN: 'synthetic-session',
    PROMPTPLAZA_API_BASE: 'https://example.org'
  }), { code: 'UNTRUSTED_SESSION_ORIGIN' });
  assert.equal(other.requests.length, 0);
  for(const base of ['https://www.promptplaza.cn:8443','https://promptplaza.cn:444']){
    const untrusted=fake(caseBody());
    await assert.rejects(run(['get','case-1'],untrusted,{
      PROMPTPLAZA_TOKEN:'synthetic-session',PROMPTPLAZA_API_BASE:base
    }),{code:'UNTRUSTED_SESSION_ORIGIN'});
    assert.equal(untrusted.requests.length,0);
  }
  const standard=fake(caseBody());
  await run(['get','case-1'],standard,{
    PROMPTPLAZA_TOKEN:'synthetic-session',PROMPTPLAZA_API_BASE:'https://www.promptplaza.cn:443'
  });
  assert.equal(standard.requests[0].auth,'Bearer synthetic-session');
});

test('anonymous source reads reject nonofficial remote origins before fetching', async () => {
  for(const base of ['https://example.org','https://www.promptplaza.cn:8443']){
    const m=fake(caseBody());
    await assert.rejects(run(['get','case-1'],m,{PROMPTPLAZA_API_BASE:base}),
      {code:'UNTRUSTED_API_ORIGIN'});
    assert.equal(m.requests.length,0);
  }
  for(const base of ['https://promptplaza.cn','https://www.promptplaza.cn:443','http://127.0.0.1:8790']){
    const m=fake(caseBody());
    assert.equal((await run(['get','case-1'],m,{PROMPTPLAZA_API_BASE:base})).prompt_available,true);
    assert.equal(m.requests.length,1);
  }
  const failure=explainFailure({code:'UNTRUSTED_API_ORIGIN'});
  assert.match(failure.next_step,/official HTTPS API/);
  assert.equal(failure.retryable,false);
});

test('invalid search shapes are errors while a valid empty result stays successful', async () => {
  for(const body of [{},{items:{}},{items:null},{error:'synthetic failure'}]){
    await assert.rejects(run(['search','cup'],fake(body)),{code:'API_SEARCH_CONTRACT_INVALID'});
  }
  const empty=await run(['search','cup'],fake({items:[],total:0,next_offset:null}));
  assert.deepEqual(empty.items,[]);
  assert.equal(empty.total,0);
  const failure=explainFailure({code:'API_SEARCH_CONTRACT_INVALID'});
  assert.match(failure.next_step,/Keep your search terms/);
  assert.equal(failure.retryable,false);
});

test('source schema and version must be explicit before accepting an original', async () => {
  for(const extra of [{schema:undefined},{source:'unverified'},{ok:undefined}]){
    await assert.rejects(run(['get','case-1'],fake({...caseBody(),...extra})),
      {code:'API_SOURCE_CONTRACT_INVALID'});
  }
  await assert.rejects(run(['get','case-1'],fake(caseBody({kind:'unknown'}))),
    {code:'API_SOURCE_CONTRACT_INVALID'});
});
test('full original bytes must agree with their source digest and byte count', async () => {
  for(const data of [{prompt_sha256:'0'.repeat(64)},{prompt_sha256:null},
    {prompt_bytes:1},{prompt_bytes:'38'}]){
    await assert.rejects(run(['get','case-1'],fake(caseBody(data))),
      {code:'API_SOURCE_INTEGRITY_INVALID'});
  }
  const original='  松间 · blue glaze\r\nNo added text.\n';
  const out=await run(['get','case-1'],fake(caseBody({prompt:original})));
  assert.equal(out.prompt,original);
  assert.equal(out.source_prompt_sha256,createHash('sha256').update(original,'utf8').digest('hex'));
});
test('missing original endpoint permits metadata fallback without promoting any text', async () => {
  const requests=[];
  const out=await execute(['get','case-1'],{env:{},fetchImpl:async url=>{
    requests.push(String(url));
    if(String(url).endsWith('/prompt'))return new Response('{}',{status:404});
    return new Response(JSON.stringify(caseBody({canonical_path:'/case/case-1'})));
  }});
  assert.equal(requests.length,2);
  assert.equal(requests[1],'https://www.promptplaza.cn/v1/cases/case-1');
  assert.equal(out.source_endpoint_available,false);
  assert.equal(out.case_url,'https://www.promptplaza.cn/case/case-1');
  assert.equal(out.prompt,null);assert.equal(out.prompt_available,false);
  assert.equal(out.source_prompt_sha256,null);
  assert.ok(out.prompt_notice);
});
test('access, revoked-session, rate and service failures never retry or downgrade identity', async () => {
  for(const status of [401,403,429,503]){
    const mock=fake({error:'PRIVATE_REMOTE_DETAIL'},status);
    await assert.rejects(run(['get','case-1'],mock,{PROMPTPLAZA_TOKEN:'synthetic-session'}),
      {code:'API_HTTP_'+status});
    assert.equal(mock.requests.length,1);
    assert.equal(mock.requests[0].auth,'Bearer synthetic-session');
  }
});
test('metadata fallback also checks the requested case identity', async () => {
  let count=0;
  await assert.rejects(execute(['get','case-1'],{env:{},fetchImpl:async()=>{
    count++;
    return count===1?new Response('{}',{status:404}):
      new Response(JSON.stringify(caseBody({id:'other-case'})));
  }}),{code:'CASE_ID_RESPONSE_MISMATCH'});
  assert.equal(count,2);
});
test('digest mismatch cannot create a downloaded file', async () => {
  const dir=await mkdtemp(join(tmpdir(),'plaza-basic-'));
  try{
    const path=join(dir,'tampered.txt');
    await assert.rejects(run(['download','case-1','--output',path],
      fake(caseBody({prompt_sha256:'0'.repeat(64)})),{},{cwd:'/another/repo'}),
      {code:'API_SOURCE_INTEGRITY_INVALID'});
    await assert.rejects(stat(path),{code:'ENOENT'});
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('invalid session whitespace fails before network access', async () => {
  const m = fake(caseBody());
  await assert.rejects(run(['get', 'case-1'], m, { PROMPTPLAZA_TOKEN: 'session with spaces' }),
    { code: 'INVALID_SESSION' });
  assert.equal(m.requests.length, 0);
});
test('API denied response does not echo private message', async () => {
  const m = fake({ error: 'SECRET_PROMPT_FROM_REMOTE' }, 403);
  await assert.rejects(run(['get', 'case-1'], m), err =>
    err.code === 'API_HTTP_403' && !String(err.message).includes('SECRET_PROMPT'));
});
test('recovery distinguishes access, missing cases, throttling and temporary service failure', () => {
  for(const [code,retryable] of [['API_HTTP_401',false],['API_HTTP_403',false],
    ['API_HTTP_404',false],['API_HTTP_429',true],['API_HTTP_503',true],
    ['API_TIMEOUT',true],['API_REQUEST_FAILED',true],['OUTPUT_EXISTS',false],
    ['FULL_ORIGINAL_PROMPT_UNAVAILABLE',false]]){
    const info=explainFailure({code,message:'PRIVATE_REMOTE_MESSAGE'});
    assert.equal(info.error,code);assert.equal(info.retryable,retryable);
    assert.ok(info.message&&info.next_step);
    assert.doesNotMatch(JSON.stringify(info),/PRIVATE_REMOTE_MESSAGE/);
  }
  assert.equal(explainFailure({code:'secret\ninput'}).error,'FAILED');
});
test('transport timeouts and failures each stop after one request', async () => {
  for(const [error,code] of [[new DOMException('fixture','TimeoutError'),'API_TIMEOUT'],
    [new Error('PRIVATE_CONNECTION_DETAIL'),'API_REQUEST_FAILED']]){
    let requests=0;
    await assert.rejects(execute(['search','cup'],{env:{PROMPTPLAZA_TOKEN:'synthetic-session'},fetchImpl:async()=>{requests++;throw error;}}),{code});
    assert.equal(requests,1);
  }
});
test('oversized response cancels its stream before collecting the full body', async () => {
  let pulls=0,cancelled=false;
  const chunk=new Uint8Array(256*1024);
  const body=new ReadableStream({pull(controller){
    if(pulls++<8)controller.enqueue(chunk);else controller.close();
  },cancel(){cancelled=true;}});
  await assert.rejects(execute(['search','cup'],{env:{PROMPTPLAZA_TOKEN:'synthetic-session'},fetchImpl:async()=>new Response(body)}),
    {code:'API_RESPONSE_TOO_LARGE'});
  assert.equal(cancelled,true);assert.ok(pulls<9);
});
test('malformed or explicitly failed API payloads cannot produce results', async () => {
  for(const [body,code] of [[null,'API_RESPONSE_INVALID'],[[],'API_RESPONSE_INVALID'],
    [{ok:false,items:[caseBody().case]},'API_REPORTED_FAILURE']]){
    await assert.rejects(run(['search','cup'],fake(body)),{code});
  }
  await assert.rejects(execute(['search','cup'],{env:{PROMPTPLAZA_TOKEN:'synthetic-session'},
    fetchImpl:async()=>new Response('{incomplete')}),{code:'API_JSON_INVALID'});
});
test('case ID mismatch cannot bind unrelated source content', async () => {
  const m = fake(caseBody({ id: 'some-other-case' }));
  await assert.rejects(run(['get', 'case-1'], m), { code: 'CASE_ID_RESPONSE_MISMATCH' });
});
test('download saves exact UTF-8 text exclusively with 0600 permissions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plaza-basic-'));
  try {
    const path = join(dir, 'original.txt');
    const m = fake(caseBody());
    const result = await run(['download', 'case-1', '--output', path], m, {}, { cwd: '/another/skill/repo' });
    assert.equal(result.generation_calls, 0);
    assert.equal(result.rights_license, 'NOASSERTION');
    assert.equal(await readFile(path, 'utf8'), 'Complete, original prompt.\nSecond line.');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const beforeRetry=m.requests.length;
    await assert.rejects(run(['download', 'case-1', '--output', path], m, {}, {cwd: '/another/skill/repo'}),
      { code: 'OUTPUT_EXISTS' });
    assert.equal(m.requests.length,beforeRetry);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('unavailable prompt cannot be downloaded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plaza-basic-'));
  try {
    const path = join(dir, 'missing.txt'), m = fake(caseBody({ prompt_status: 'excerpt' }));
    await assert.rejects(run(['download', 'case-1', '--output', path], m, {}, { cwd: '/another/repo' }),
      { code: 'FULL_ORIGINAL_PROMPT_UNAVAILABLE' });
    await assert.rejects(stat(path), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('symlink parent and output within repository are refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plaza-basic-'));
  try {
    await mkdir(join(dir, 'repo')); await mkdir(join(dir, 'safe'));
    await symlink(join(dir, 'safe'), join(dir, 'link'));
    const m = fake(caseBody());
    await assert.rejects(run(['download','case-1','--output',join(dir,'link','x.txt')],m,{}, {cwd:join(dir,'repo')}),
      { code: 'OUTPUT_PARENT_INVALID' });
    await assert.rejects(run(['download','case-1','--output',join(dir,'repo','x.txt')],m,{}, {cwd:join(dir,'repo')}),
      { code: 'OUTPUT_INSIDE_REPOSITORY' });
    assert.equal(m.requests.length,0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('using an absolute installed CLI cannot write original text into the Skill itself', async () => {
  const m=fake(caseBody());
  const path=fileURLToPath(new URL('../original-must-not-be-written.txt',import.meta.url));
  await assert.rejects(run(['download','case-1','--output',path],m,{},
    {cwd:'/different/user/project'}),{code:'OUTPUT_INSIDE_REPOSITORY'});
  assert.equal(m.requests.length,0);
});

test('Agent-only rewrite instructions never become a hidden CLI command', async () => {
  const pkg = JSON.parse(await readFile(new URL('../PACKAGE.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg.allowed_commands, ['search', 'get', 'download', 'capabilities', 'creative', 'usage', 'status', 'login', 'logout']);
  assert.deepEqual(pkg.agent_only_capabilities, ['single_case_simple_rewrite', 'guided_progressive_questions']);
  assert.equal(pkg.model_execution_by_package, false);
  const mock = fake(caseBody());
  await assert.rejects(run(['rewrite', 'case-1'], mock), { code: 'UNKNOWN_COMMAND' });
  assert.equal(mock.requests.length, 0);
});

test('source projection stays literal even when host may author a separate draft', () => {
  const source = projectCase(caseBody({ prompt_status: 'excerpt', prompt: 'short fragment' }));
  assert.equal(source.prompt_available, false);
  assert.equal(source.prompt, null);
  assert.equal(source.republication_authorized_by_skill, false);
});

test('host GrillMe guidance stays available without shipping the private interview engine', async () => {
  const pkg = JSON.parse(await readFile(new URL('../PACKAGE.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private_interview_engine_included, false);
  assert.deepEqual(pkg.allowed_commands, ['search', 'get', 'download', 'capabilities', 'creative', 'usage', 'status', 'login', 'logout']);
  const mock = fake(caseBody());
  await assert.rejects(run(['grillme', 'case-1'], mock), { code: 'UNKNOWN_COMMAND' });
  assert.equal(mock.requests.length, 0);
});


const creativeOps=['compile','revise','remix','remix-revise','interview-new','interview-next','interview-answer',
  'case-ideas','recipe-catalog','recipe-compile'];
const creativeArgs=(operation='compile',key='task-fixture-00000001')=>[
  'creative',operation,'--input','-','--request-id',key
];
const creativeEnv={PROMPTPLAZA_TOKEN:'synthetic-authorized-session'};
function creativeBody(operation='compile',result={state:'COMPILED_NOT_RUN',artifacts:[]}){
  return {ok:true,schema:'promptplaza-skill-result-v1',operation,result,execution:'NOT_RUN'};
}
function capabilityBody(extra={}){
  return {ok:true,schema:'promptplaza-skill-capabilities-v1',operations:creativeOps,
    same_features_for_all_plans:true,execution:'NOT_RUN',requires_session_for_creative:true,
    admission_configured:false,packs:[{id:'product-series',title:'Product series',medium:'image'}],...extra};
}
test('stored authored ideas and recipe discovery are not mislabeled as newly authored drafts',async()=>{
  for(const op of ['case-ideas','recipe-catalog']){
    const m=fake(creativeBody(op,{schema:op==='case-ideas'?'plaza-authored-ideas-v1':'plaza-recipe-catalog-v1'}));
    const out=await run(creativeArgs(op),m,creativeEnv,{input:'{}'});
    assert.equal(out.operation,op);assert.equal(out.draft_status,undefined);assert.equal(m.requests.length,1);
  }
  const m=fake(creativeBody('recipe-compile',{prompt:'Complete synthetic recipe draft.'}));
  const out=await run(creativeArgs('recipe-compile'),m,creativeEnv,{input:'{}'});
  assert.equal(out.draft_status,'DRAFT_NOT_RUN');assert.equal(m.requests.length,1);
});
test('asset availability and invalid slot errors retain safe recovery without retries',async()=>{
  for(const [code,status] of [['SKILL_CASE_UNAVAILABLE',404],['SKILL_RECIPE_NOT_FOUND',404],
    ['SKILL_RECIPE_INPUT_INVALID',422],['SKILL_ASSET_INTEGRITY',503]]){
    const m=fake({error:code,private_path:'/server/DO_NOT_EXPORT'},status);
    await assert.rejects(run(creativeArgs('case-ideas'),m,creativeEnv,{input:'{}'}),error=>{
      const info=explainFailure(error);assert.equal(error.code,code);
      assert.doesNotMatch(JSON.stringify(info),/DO_NOT_EXPORT/);return true;
    });
    assert.equal(m.requests.length,1);
  }
});
test('public candidate shares remote operations while excluding private implementation',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../PACKAGE.json',import.meta.url),'utf8'));
  assert.deepEqual(pkg.remote_private_creative_operations,creativeOps);
  assert.equal(pkg.same_features_for_all_account_tiers,true);
  assert.equal(pkg.proprietary_source_files_included,false);
  assert.equal(pkg.private_interview_engine_included,false);
  assert.equal(pkg.model_execution_by_package,false);
});
test('help advertises the unified transport without network or implicit execution',async()=>{
  const m=fake({});
  const out=await run(['help'],m);
  assert.deepEqual(out.creative_operations,creativeOps);
  assert.equal(out.creative_service_status,'FREE_ACCOUNT_SERVICE');
  assert.equal(out.generation_calls,0);
  assert.equal(m.requests.length,0);
});
test('capability discovery retains readiness and public packs but strips private rules',async()=>{
  const m=fake(capabilityBody({private_rules:'PRIVATE_METHOD',packs:[{
    id:'short-film',title:'Short film',medium:'video',rules:['PRIVATE_METHOD'],keywords:['SECRET_KEYWORD']
  }]}));
  const out=await run(['capabilities'],m);
  assert.deepEqual(out.operations,creativeOps);
  assert.equal(out.same_features_for_all_plans,true);
  assert.equal(out.admission_configured,false);
  assert.equal(out.requires_session_for_creative,true);
  assert.deepEqual(out.packs,[{id:'short-film',title:'Short film',medium:'video'}]);
  assert.doesNotMatch(JSON.stringify(out),/PRIVATE_METHOD|SECRET_KEYWORD/);
  assert.equal(m.requests[0].method,'GET');
  assert.equal(m.requests[0].url,'https://www.promptplaza.cn/v1/skill/capabilities');
  assert.equal(m.requests[0].auth,undefined);
});
test('capabilities tolerate added operations and report unavailable known operations',async()=>{
  const added=await run(['capabilities'],fake(capabilityBody({operations:[...creativeOps,'future-operation']})));
  assert.deepEqual(added.operations,creativeOps);
  assert.deepEqual(added.unavailable_operations,[]);
  const subset=await run(['capabilities'],fake(capabilityBody({operations:['compile','revise']})));
  assert.deepEqual(subset.operations,['compile','revise']);
  assert.deepEqual(subset.unavailable_operations,creativeOps.filter(x=>!['compile','revise'].includes(x)));
  const empty=await run(['capabilities'],fake(capabilityBody({operations:[]})));
  assert.deepEqual(empty.operations,[]);
  assert.deepEqual(empty.unavailable_operations,creativeOps);
  const packs=Array.from({length:7},(_,i)=>({id:'public-pack-'+i,title:'Public pack '+i,medium:'image'}));
  assert.equal((await run(['capabilities'],fake(capabilityBody({packs})))).packs.length,7);
});
test('compatible discovery still rejects malformed or duplicate capabilities',async()=>{
  for(const body of [capabilityBody({operations:['compile',null]}),
    capabilityBody({operations:['compile','INVALID!']}),
    capabilityBody({operations:['future-operation','future-operation']}),
    capabilityBody({packs:[{id:'same',title:'A',medium:'image'},{id:'same',title:'B',medium:'image'}]})]){
    await assert.rejects(run(['capabilities'],fake(body)),{code:'API_SKILL_CONTRACT_INVALID'});
  }
});
test('source size and missing-source failures remain distinct without truncation or retries',async()=>{
  for(const code of ['SOURCE_PROMPT_TOO_LARGE','SOURCE_PROMPT_MISSING','SPEC_TOO_LARGE']){
    const m=fake({error:code},422);
    await assert.rejects(run(creativeArgs(),m,creativeEnv,{input:'{}'}),error=>{
      assert.equal(error.code,code);
      assert.equal(explainFailure(error).retryable,false);
      return true;
    });
    assert.equal(m.requests.length,1);
  }
});
test('malformed capability and result contracts never become success',async()=>{
  for(const body of [capabilityBody({operations:['compile','compile']}),capabilityBody({same_features_for_all_plans:false}),
    capabilityBody({execution:'GENERATED'}),capabilityBody({packs:[{id:'invalid',medium:'image'}]})]){
    await assert.rejects(run(['capabilities'],fake(body)),{code:'API_SKILL_CONTRACT_INVALID'});
  }
  for(const body of [creativeBody('remix'),creativeBody('compile',null),
    {...creativeBody(),schema:'unknown'}, {...creativeBody(),execution:'GENERATED'}]){
    await assert.rejects(run(creativeArgs(),fake(body),creativeEnv,{input:'{}'}),{code:'API_SKILL_CONTRACT_INVALID'});
  }
});
test('creative transport sends each supported operation once using the existing session and stable key',async()=>{
  for(const operation of creativeOps){
    const m=fake(creativeBody(operation,{state:'DRAFT_NOT_RUN',synthetic:true}));
    const out=await run(creativeArgs(operation),m,creativeEnv,{input:Buffer.from('{"synthetic":"input"}')});
    assert.equal(m.requests.length,1);
    const call=m.requests[0];
    assert.equal(call.method,'POST');assert.equal(call.redirect,'error');
    assert.equal(call.auth,'Bearer synthetic-authorized-session');
    assert.equal(call.requestId,'task-fixture-00000001');
    assert.equal(call.url,'https://www.promptplaza.cn/v1/skill/creative');
    assert.deepEqual(JSON.parse(call.body),{schema:'promptplaza-skill-request-v1',operation,input:{synthetic:'input'}});
    assert.equal(out.operation,operation);assert.equal(out.execution,'NOT_RUN');assert.equal(out.generation_calls,0);
    const createsDraft=!operation.startsWith('interview-')&&!['case-ideas','recipe-catalog'].includes(operation);
    assert.equal(out.draft_status,createsDraft?'DRAFT_NOT_RUN':undefined);
    assert.doesNotMatch(JSON.stringify(out),/synthetic-authorized-session/);
  }
});
test('creative requires known operation, stdin, stable ID and authorized session before reading input or network',async()=>{
  const m=fake(creativeBody());
  for(const [args,env,code] of [
    [creativeArgs('provider-run'),creativeEnv,'CREATIVE_OPERATION_INVALID'],
    [['creative','compile','--input','/arbitrary/file','--request-id','task-fixture-00000001'],creativeEnv,'CREATIVE_STDIN_REQUIRED'],
    [['creative','compile','--input','-'],creativeEnv,'REQUEST_ID_REQUIRED'],
    [creativeArgs('compile','short'),creativeEnv,'REQUEST_ID_REQUIRED'],
    [creativeArgs('compile','task with spaces!'),creativeEnv,'REQUEST_ID_REQUIRED'],
    [creativeArgs(),{},'SESSION_REQUIRED'],
    [creativeArgs(),{PROMPTPLAZA_TOKEN:'session with spaces'},'INVALID_SESSION'],
    [creativeArgs(),{...creativeEnv,PROMPTPLAZA_API_BASE:'https://untrusted.invalid'},'UNTRUSTED_SESSION_ORIGIN']
  ])await assert.rejects(run(args,m,env,{input:undefined}),{code});
  assert.equal(m.requests.length,0);
});
test('creative input is bounded strict UTF-8 object JSON, and envelope size counts toward the limit',async()=>{
  const m=fake(creativeBody());
  for(const input of ['{broken','null','[]','1','{}\n{}',Buffer.from([0xff]),{}]){
    await assert.rejects(run(creativeArgs(),m,creativeEnv,{input}),{code:'CREATIVE_INPUT_INVALID'});
  }
  await assert.rejects(run(creativeArgs(),m,creativeEnv,{input:'x'.repeat(256*1024+1)}),
    {code:'CREATIVE_INPUT_TOO_LARGE'});
  // The JSON itself fits; the versioned protocol envelope makes it too large.
  await assert.rejects(run(creativeArgs(),m,creativeEnv,{input:JSON.stringify({text:'x'.repeat(256*1024-20)})}),
    {code:'CREATIVE_INPUT_TOO_LARGE'});
  assert.equal(m.requests.length,0);
});
test('private service missing, admission unavailable, quota and busy failures are distinct without retries or response leakage',async()=>{
  const rows=[
    [404,{message:'PRIVATE_BODY'},'SKILL_SERVICE_UNAVAILABLE'],
    [503,{error:'SKILL_ADMISSION_UNAVAILABLE',details:'PRIVATE_BODY'},'SKILL_ADMISSION_UNAVAILABLE'],
    [429,{error:'SKILL_QUOTA_EXHAUSTED',token:'PRIVATE_BODY'},'SKILL_QUOTA_EXHAUSTED'],
    [429,{error:'SKILL_BUSY',recipe:'PRIVATE_BODY'},'SKILL_BUSY'],
    [409,{error:'SKILL_REQUEST_CONFLICT',private_value:'PRIVATE_BODY'},'SKILL_REQUEST_CONFLICT'],
    [503,{error:'PRIVATE_BODY'},'API_HTTP_503']
  ];
  for(const [status,body,code] of rows){
    const m=fake(body,status);
    await assert.rejects(run(creativeArgs(),m,creativeEnv,{input:'{}'}),e=>{
      assert.equal(e.code,code);assert.doesNotMatch(JSON.stringify(explainFailure(e)),/PRIVATE_BODY/);return true;
    });
    assert.equal(m.requests.length,1);
  }
  assert.equal(explainFailure({code:'SKILL_QUOTA_EXHAUSTED'}).retryable,false);
  assert.equal(explainFailure({code:'SKILL_BUSY'}).retryable,true);
});
test('creative upstream timeout and redirect cannot cause an automatic retry or local substitute',async()=>{
  let calls=0;
  await assert.rejects(execute(creativeArgs(),{env:creativeEnv,input:'{}',fetchImpl:async()=>{
    calls++;throw new DOMException('private timeout','TimeoutError');
  }}),{code:'API_TIMEOUT'});
  assert.equal(calls,1);
  const m=fake({ok:false},302);
  await assert.rejects(run(creativeArgs(),m,creativeEnv,{input:'{}'}),{code:'API_HTTP_302'});
  assert.equal(m.requests.length,1);assert.equal(m.requests[0].redirect,'error');
});


test('actual backend quota429 envelope preserves allowance guidance rather than a generic retry',async()=>{
  const m=fake({ok:false,error:'SKILL_QUOTA_EXCEEDED',execution:'NOT_RUN'},429);
  await assert.rejects(run(creativeArgs(),m,creativeEnv,{input:'{}'}),error=>{
    const info=explainFailure(error);
    assert.equal(error.code,'SKILL_QUOTA_EXCEEDED');
    assert.equal(info.retryable,false);
    assert.match(info.message,/account allowance/);
    assert.match(info.next_step,/allowances and reset time/);
    assert.doesNotMatch(info.next_step,/try again|retry manually|wait and retry/i);
    return true;
  });
  assert.equal(m.requests.length,1);
});
test('backend auth/admission timeouts and input JSON codes retain typed safe guidance',async()=>{
  for(const [code,status,retryable] of [
    ['SKILL_AUTH_TIMEOUT',504,true],['SKILL_ADMISSION_TIMEOUT',504,true],
    ['SKILL_READ_TIMEOUT',504,true],['SKILL_JSON_INVALID',422,false],['SKILL_JSON_REQUIRED',415,false]
  ]){
    const m=fake({ok:false,error:code,execution:'NOT_RUN',details:'PRIVATE_FAILURE_DETAIL'},status);
    await assert.rejects(run(creativeArgs(),m,creativeEnv,{input:'{}'}),error=>{
      assert.equal(error.code,code);
      const info=explainFailure(error);
      assert.equal(info.retryable,retryable);
      assert.doesNotMatch(JSON.stringify(info),/PRIVATE_FAILURE_DETAIL/);
      if(retryable)assert.match(info.next_step,/same input and request ID/);
      else assert.match(info.next_step,/bounded JSON/);
      return true;
    });
    assert.equal(m.requests.length,1);
  }
});
