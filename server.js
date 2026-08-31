import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CanonicalContract } from "./contract.js";
import { Registry } from "./registry.js";
import { normalizePlan, planLabel } from "./entitlement.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(root, "public");
const PORT = Number(process.env.PORT || 3010), HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "https://markt.digitalisierungsplanung.de";
const SCHEMA_URL = "https://digitalisierungsplanung.de/contracts/preset-package.schema.json";
const REGISTRY_PATH = resolve(process.env.REGISTRY_PATH || "/home/operator/.local/share/dp-market/registry.json");
const PUBLISH_TOKEN = process.env.PUBLISH_TOKEN || "", ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const ACCOUNTS_ORIGIN = process.env.ACCOUNTS_ORIGIN || "https://accounts.digitalisierungsplanung.de";
const contract = new CanonicalContract(SCHEMA_URL), registry = new Registry(REGISTRY_PATH);
await registry.load(); await contract.refresh();
const requests = new Map();

function headers(extra={}) { return { "content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://accounts.digitalisierungsplanung.de; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://digitalisierungsplanung.de", "x-content-type-options":"nosniff", "referrer-policy":"no-referrer", "permissions-policy":"camera=(), microphone=(), geolocation=()", "cross-origin-opener-policy":"same-origin", ...extra }; }
function send(res,status,body,extra={}) { const data=typeof body==="string"?body:JSON.stringify(body); res.writeHead(status,headers({"content-type":typeof body==="string"?"text/plain; charset=utf-8":"application/json; charset=utf-8","content-length":Buffer.byteLength(data),...extra})); res.end(data); }
function recordView(record){return{id:record.manifest.id,name:record.manifest.name,description:record.manifest.description||"",publisher:record.manifest.publisher,version:record.manifest.version,plan:normalizePlan(record.plan||"trial"),planLabel:planLabel(record.plan||"trial"),status:record.status,categories:record.manifest.contributes.categories,presetCount:record.manifest.contributes.presets.length,presets:record.manifest.contributes.presets.map(p=>({id:p.id,title:p.title,description:p.description||"",categoryId:p.categoryId})),downloads:record.downloads||0,updatedAt:record.updatedAt};}
function bearer(req){const v=req.headers.authorization||"";return v.startsWith("Bearer ")?v.slice(7):"";} function same(a,b){if(!a||!b||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
function sessionCookie(req){const raw=String(req.headers.cookie||"");const match=raw.match(/(?:^|; )dp_session=([^;]+)/);return match?match[1]:"";}
function forwardedSetCookie(response){
  if(!response||!response.headers)return [];
  if(typeof response.headers.getSetCookie==="function")return response.headers.getSetCookie().filter(Boolean);
  const raw=response.headers.get("set-cookie");
  return raw?[raw]:[];
}
async function accountSession(req, fetcher=globalThis.fetch){
  const cookie=sessionCookie(req);
  if(!cookie)return {authenticated:false,isAdmin:false,setCookie:[]};
  try{
    const response=await fetcher(`${ACCOUNTS_ORIGIN}/api/license/me`,{headers:{cookie:`dp_session=${cookie}`,accept:"application/json"},signal:AbortSignal.timeout(5000)});
    const setCookie=forwardedSetCookie(response);
    if(!response.ok)return {authenticated:false,isAdmin:false,setCookie};
    const body=await response.json();
    return {authenticated:body.authenticated===true,isAdmin:body.isAdmin===true,email:body.email||"",package:body.package||null,plan:body.plan||null,setCookie};
  }catch{return {authenticated:false,isAdmin:false,setCookie:[]};}
}
async function adminIdentity(req){
  if(ADMIN_TOKEN&&same(bearer(req),ADMIN_TOKEN))return {ok:true,via:"token"};
  const session=await accountSession(req);
  if(session.isAdmin)return {ok:true,via:"session",email:session.email};
  return {ok:false};
}
async function adminGate(req,res){
  const identity=await adminIdentity(req);
  if(identity.ok)return identity;
  send(res,401,{error:"unauthorized"});
  return {ok:false};
}
async function publishGate(req,res){
  const admin=await adminIdentity(req);
  if(admin.ok)return {...admin,status:"published"};
  if(!PUBLISH_TOKEN){send(res,503,{error:"publishing_disabled"});return {ok:false};}
  if(!same(bearer(req),PUBLISH_TOKEN)){send(res,401,{error:"unauthorized"});return {ok:false};}
  return {ok:true,via:"publish",status:"pending"};
}
function originOk(req,res){const origin=req.headers.origin;if(origin&&origin!==PUBLIC_ORIGIN){send(res,403,{error:"forbidden_origin"});return false;}return true;}
function rateOk(req,res){const ip=req.socket.remoteAddress||"unknown",now=Date.now(),slot=requests.get(ip)||{start:now,count:0};if(now-slot.start>60000){slot.start=now;slot.count=0;}slot.count++;requests.set(ip,slot);if(slot.count>300){send(res,429,{error:"rate_limited"},{"retry-after":"60"});return false;}return true;}
async function bodyJson(req,res){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>524288){send(res,413,{error:"payload_too_large"});return null;}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString("utf8")||"null");}catch{send(res,400,{error:"invalid_json"});return null;}}
function contractReady(res){if(contract.info().ready)return true;send(res,503,{error:"canonical_contract_unavailable",contract:contract.info()});return false;}
async function canonicalValid(manifest,res,{invalidStatus=422}={}){const checked=await contract.validateCanonical(manifest);if(checked.ok)return true;if(checked.unavailable){send(res,503,{error:"canonical_validator_unavailable",details:checked.errors});return false;}send(res,invalidStatus,{error:"invalid_package",details:checked.errors});return false;}
const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".ico":"image/x-icon"};
async function staticFile(pathname,res){const rel=pathname==="/"?"index.html":pathname==="/admin"||pathname==="/admin/"?"admin.html":decodeURIComponent(pathname).replace(/^\/+/,"");const path=resolve(publicDir,rel);if(path!==publicDir&&!path.startsWith(publicDir+sep))return false;try{if(!(await stat(path)).isFile())return false;const data=await readFile(path);res.writeHead(200,headers({"content-type":mime[extname(path)]||"application/octet-stream","content-length":data.length,"cache-control":process.env.NODE_ENV==="production"?"public,max-age=3600":"no-store"}));res.end(data);return true;}catch{return false;}}

const server=createServer(async(req,res)=>{try{if(!rateOk(req,res))return;const url=new URL(req.url,`http://${req.headers.host||"localhost"}`),path=url.pathname;
if(req.method==="GET"&&path==="/healthz")return send(res,contract.info().ready?200:503,{ok:contract.info().ready,contract:contract.info(),packages:registry.list().length});
if(req.method==="GET"&&path==="/api/contract")return send(res,200,contract.info());
if(req.method==="GET"&&path==="/api/me"){const session=await accountSession(req);const extra=session.setCookie?.length?{"set-cookie":session.setCookie}:{};const {setCookie,...body}=session;return send(res,200,body,extra);}
if(req.method==="POST"&&path==="/api/contract/refresh"){if(!originOk(req,res)||!(await adminGate(req,res)).ok)return;const ok=await contract.refresh();return send(res,ok?200:503,contract.info());}
if(req.method==="GET"&&path==="/api/categories")return send(res,200,{categories:registry.categories()});
if(req.method==="GET"&&path==="/api/packages") {const items=registry.list({q:url.searchParams.get("q")||"",category:url.searchParams.get("category")||"",sort:url.searchParams.get("sort")||"newest"});return send(res,200,{packages:items.map(recordView),total:items.length});}
const manifestMatch=path.match(/^\/api\/packages\/([^/]+)\/manifest$/);if(req.method==="GET"&&manifestMatch){if(!contractReady(res))return;const r=registry.get(decodeURIComponent(manifestMatch[1]));if(!r||r.status!=="published")return send(res,404,{error:"not_found"});if(!(await canonicalValid(r.manifest,res,{invalidStatus:503})))return;return send(res,200,r.manifest);}
const downloadMatch=path.match(/^\/api\/packages\/([^/]+)\/download$/);if(req.method==="POST"&&downloadMatch){if(!contractReady(res))return;const r=registry.get(decodeURIComponent(downloadMatch[1]));if(!r||r.status!=="published")return send(res,404,{error:"not_found"});if(!(await canonicalValid(r.manifest,res,{invalidStatus:503})))return;await registry.countDownload(r.manifest.id);return send(res,200,{manifest:r.manifest});}
const detailMatch=path.match(/^\/api\/packages\/([^/]+)$/);if(req.method==="GET"&&detailMatch){const r=registry.get(decodeURIComponent(detailMatch[1]));return !r||r.status!=="published"?send(res,404,{error:"not_found"}):send(res,200,recordView(r));}
if(req.method==="GET"&&path==="/api/admin/packages"){if(!(await adminGate(req,res)).ok)return;const items=registry.list({q:url.searchParams.get("q")||"",includePending:true,sort:url.searchParams.get("sort")||"newest"});return send(res,200,{packages:items.map(recordView),total:items.length});}
if(req.method==="POST"&&path==="/api/packages"){if(!originOk(req,res)||!contractReady(res))return;const gate=await publishGate(req,res);if(!gate.ok)return;const body=await bodyJson(req,res);if(body===null)return;const wrapped=body&&typeof body==="object"&&body.package&&body.package.schema==="preset-package/1";const manifest=wrapped?body.package:body;const plan=normalizePlan((wrapped?body.plan:body&&body.plan)||url.searchParams.get("plan"));if(!(await canonicalValid(manifest,res)))return;const previous=registry.get(manifest.id);if(previous&&previous.manifest.publisher!==manifest.publisher)return send(res,409,{error:"publisher_mismatch"});const r=await registry.upsert(manifest,gate.status,plan);return send(res,previous?200:201,{id:r.manifest.id,status:r.status,version:r.manifest.version,plan:r.plan});}
const adminMatch=path.match(/^\/api\/admin\/packages\/([^/]+)\/status$/);if(req.method==="PATCH"&&adminMatch){if(!originOk(req,res)||!(await adminGate(req,res)).ok||!contractReady(res))return;const body=await bodyJson(req,res);if(body===null)return;const id=decodeURIComponent(adminMatch[1]),r=registry.get(id);if(!r)return send(res,404,{error:"not_found"});if(body.status){const status=String(body.status);if(!["pending","published","rejected"].includes(status))return send(res,422,{error:"invalid_status"});if(!(await canonicalValid(r.manifest,res)))return;await registry.setStatus(id,status);}if(body.plan)await registry.setPlan(id,body.plan);const fresh=registry.get(id);return send(res,200,{id,status:fresh.status,plan:fresh.plan});}
const adminItem=path.match(/^\/api\/admin\/packages\/([^/]+)$/);if(req.method==="DELETE"&&adminItem){if(!originOk(req,res)||!(await adminGate(req,res)).ok)return;const id=decodeURIComponent(adminItem[1]);const removed=await registry.remove(id);return removed?send(res,200,{id,removed:true}):send(res,404,{error:"not_found"});}
if(req.method==="GET"&&await staticFile(path,res))return;send(res,404,{error:"not_found"});}catch(error){console.error(error);if(!res.headersSent)send(res,500,{error:"internal_error"});else res.destroy();}});
if(process.env.NODE_ENV!=="test")server.listen(PORT,HOST,()=>{console.log(`markt listening on http://${HOST}:${PORT}`);console.log(`canonical preset contract: ${contract.info().ready?"ready":`UNAVAILABLE: ${contract.info().error}`}`);});
export{server,contract,registry};
