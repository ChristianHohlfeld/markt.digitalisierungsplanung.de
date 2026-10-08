import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CanonicalContract } from "./contract.js";
import { Registry } from "./registry.js";
import { accessFor, canUse, normalizePlan, planAllows, planLabel, viewerPlan } from "./entitlement.js";
import { featuredCardHtml } from "./public/storefront-view.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(root, "public");
const PORT = Number(process.env.PORT || 3010), HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "https://markt.digitalisierungsplanung.de";
const SCHEMA_URL = "https://digitalisierungsplanung.de/contracts/preset-package.schema.json";
const REGISTRY_PATH = resolve(process.env.REGISTRY_PATH || "/home/operator/.local/share/dp-market/registry.json");
const PUBLISH_TOKEN = process.env.PUBLISH_TOKEN || "", ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const ACCOUNTS_ORIGIN = process.env.ACCOUNTS_ORIGIN || "https://accounts.digitalisierungsplanung.de";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const ORDER_EMAIL = process.env.ORDER_EMAIL || "post@digitalisierungsplanung.de";
const contract = new CanonicalContract(SCHEMA_URL), registry = new Registry(REGISTRY_PATH);
await registry.load(); await contract.refresh();
await seedCatalog();

// Canonical packages (e.g. Freigaben & Genehmigungen) ship with the release.
async function seedCatalog(){
  try{
    const catalog=JSON.parse(await readFile(resolve(root,"seed","catalog.json"),"utf8"));
    const entries=[];
    for(const item of Array.isArray(catalog.packages)?catalog.packages:[]){
      const file=resolve(root,"seed",String(item.file||""));
      if(!file.startsWith(resolve(root,"seed")+sep))continue;
      entries.push({manifest:JSON.parse(await readFile(file,"utf8")),plan:item.plan,offer:item.offer});
    }
    await registry.seed(entries);
  }catch(error){if(error?.code!=="ENOENT")console.error("seed catalog failed",error);}
}
const requests = new Map();

const METRICS_ALLOWED = new Set(["listing_open", "cta_click"]);
const METRICS_DIR = resolve(process.env.METRICS_DIR || resolve(root, ".data"));
const METRICS_PATH = resolve(METRICS_DIR, "metrics.jsonl");
const METRICS_RETENTION_DAYS = 90;
const metricsRates = new Map();
function metricsLimited(ip){
  const now=Date.now(), prev=metricsRates.get(ip)||[];
  const next=prev.filter(x=>now-x<60000);
  if(next.length>=120){ metricsRates.set(ip,next); return true; }
  next.push(now); metricsRates.set(ip,next);
  if(metricsRates.size>10000){ for(const [key,hits] of metricsRates){ if(!hits.some(x=>now-x<60000)) metricsRates.delete(key); } }
  return false;
}
async function recordMetric(row){
  await mkdir(METRICS_DIR, { recursive: true });
  await appendFile(METRICS_PATH, JSON.stringify(row) + "\n", "utf8");
}


function headers(extra={}) { return { "content-security-policy":"default-src 'self'; script-src 'self' https://digitalisierungsplanung.de; style-src 'self' https://digitalisierungsplanung.de; img-src 'self' data: https://digitalisierungsplanung.de; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'", "x-content-type-options":"nosniff", "referrer-policy":"no-referrer", "permissions-policy":"camera=(), microphone=(), geolocation=()", "cross-origin-opener-policy":"same-origin", "cross-origin-resource-policy":"same-origin", "cache-control":"no-store", ...extra }; }
function send(res,status,body,extra={}) { const data=typeof body==="string"?body:JSON.stringify(body); res.writeHead(status,headers({"content-type":typeof body==="string"?"text/plain; charset=utf-8":"application/json; charset=utf-8","content-length":Buffer.byteLength(data),...extra})); res.end(data); }
function presetView(p){return{id:p.id,title:p.title,description:p.description||"",categoryId:p.categoryId,kind:p.kind==="process"?"process":"block",steps:(p.states||[]).map(st=>String(st.title||st.key||"")).filter(Boolean).slice(0,12),approvals:(p.transitions||[]).filter(t=>t.decision==="human").length,quorum:Math.max(1,...(p.transitions||[]).map(t=>Number(t.approval?.quorum)||1))};}
function offerView(record){const offer=record.offer||{};return{kind:offer.kind||"included",priceCents:offer.priceCents||0,currency:offer.currency||"EUR",tagline:offer.tagline||"",highlights:offer.highlights||[],featured:offer.featured===true,includedFrom:normalizePlan(record.plan||"trial"),includedFromLabel:planLabel(record.plan||"trial")};}
function catalogView(record,access){return{id:record.manifest.id,name:record.manifest.name,description:record.manifest.description||"",publisher:record.manifest.publisher,version:record.manifest.version,categories:record.manifest.contributes.categories,presetCount:record.manifest.contributes.presets.length,presets:record.manifest.contributes.presets.map(presetView),offer:offerView(record),access,updatedAt:record.updatedAt};}
function sessionEmail(session){return String(session?.email||"").trim().toLowerCase();}
function accessOf(record,viewer,session){return accessFor(record,viewer,registry.hasPurchase(sessionEmail(session),record.manifest.id));}
function recordView(record){return{id:record.manifest.id,name:record.manifest.name,description:record.manifest.description||"",publisher:record.manifest.publisher,version:record.manifest.version,plan:normalizePlan(record.plan||"trial"),planLabel:planLabel(record.plan||"trial"),status:record.status,categories:record.manifest.contributes.categories,presetCount:record.manifest.contributes.presets.length,presets:record.manifest.contributes.presets.map(p=>({id:p.id,title:p.title,description:p.description||"",categoryId:p.categoryId})),downloads:record.downloads||0,updatedAt:record.updatedAt};}
function bearer(req){const v=req.headers.authorization||"";return v.startsWith("Bearer ")?v.slice(7):"";}
function same(a,b){const left=Buffer.from(String(a||""),"utf8"),right=Buffer.from(String(b||""),"utf8");return left.length>0&&left.length===right.length&&timingSafeEqual(left,right);}
function sessionCookie(req){for(const part of String(req.headers.cookie||"").split(";")){const [name,...rest]=part.trim().split("=");if(name==="dp_session"&&rest.length)return rest.join("=");}return "";}
function forwardedSetCookie(response){
  if(!response||!response.headers)return [];
  if(typeof response.headers.getSetCookie==="function")return response.headers.getSetCookie().filter(Boolean);
  const raw=response.headers.get("set-cookie");
  return raw?[raw]:[];
}
function sessionResponseHeaders(session){return session?.setCookie?.length?{"set-cookie":session.setCookie}:{};}
function forwardSessionCookie(res,session){if(session?.setCookie?.length)res.setHeader("set-cookie",session.setCookie);}
function clientIp(req){
  const normalize=value=>String(value||"").replace(/^::ffff:/,"").trim();
  const remote=normalize(req.socket?.remoteAddress),loopback=remote==="127.0.0.1"||remote==="::1";
  if(loopback){const forwarded=normalize(String(req.headers["x-real-ip"]||"").split(",")[0]);if(isIP(forwarded))return forwarded;}
  return isIP(remote)?remote:"unknown";
}
async function accountLogout(req,fetcher=globalThis.fetch){
  const fallback=['dp_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Secure; Domain=.digitalisierungsplanung.de'];
  const cookie=sessionCookie(req);if(!cookie)return fallback;
  try{const response=await fetcher(`${ACCOUNTS_ORIGIN}/logout`,{method:"POST",headers:{cookie:`dp_session=${cookie}`,accept:"application/json"},signal:AbortSignal.timeout(5000)});const setCookie=forwardedSetCookie(response);return setCookie.length?setCookie:fallback;}catch{return fallback;}
}
async function accountSession(req, fetcher=globalThis.fetch){
  const cookie=sessionCookie(req);
  if(!cookie)return {authenticated:false,isAdmin:false,setCookie:[]};
  try{
    const response=await fetcher(`${ACCOUNTS_ORIGIN}/api/license/me`,{headers:{cookie:`dp_session=${cookie}`,accept:"application/json"},signal:AbortSignal.timeout(5000)});
    const setCookie=forwardedSetCookie(response);
    if(!response.ok)return {authenticated:false,isAdmin:false,setCookie};
    const body=await response.json();
    return {authenticated:body.authenticated===true,isAdmin:body.isAdmin===true,email:body.email||"",package:body.package||null,plan:body.plan||null,expired:body.expired!==false,setCookie};
  }catch{return {authenticated:false,isAdmin:false,setCookie:[]};}
}
async function viewerGate(req,res){
  const session=await accountSession(req);
  forwardSessionCookie(res,session);
  const viewer=viewerPlan(session);
  if(!viewer){send(res,401,{error:"authentication_required"});return {ok:false,session,viewer:null};}
  return {ok:true,session,viewer};
}
// Entitled = included in the plan or bought by this account.
function entitled(record,viewer,session=null){return Boolean(record&&record.status==="published"&&(planAllows(viewer,record.plan||"trial")||registry.hasPurchase(sessionEmail(session),record.manifest.id)));}
function visibleRecords(viewer,options={},session=null){return registry.list(options).filter(record=>entitled(record,viewer,session));}
function visibleCategories(viewer){
  const map=new Map();
  for(const item of visibleRecords(viewer))for(const category of item.manifest.contributes.categories){const current=map.get(category.id)||{...category,count:0};current.count+=1;map.set(category.id,current);}
  return [...map.values()].sort((a,b)=>a.label.localeCompare(b.label,"de"));
}
async function adminIdentity(req){
  if(ADMIN_TOKEN&&same(bearer(req),ADMIN_TOKEN))return {ok:true,via:"token",setCookie:[]};
  const session=await accountSession(req);
  if(session.isAdmin)return {ok:true,via:"session",email:session.email,setCookie:session.setCookie||[]};
  return {ok:false,setCookie:session.setCookie||[]};
}
async function adminGate(req,res){
  const identity=await adminIdentity(req);
  forwardSessionCookie(res,identity);
  if(identity.ok)return identity;
  send(res,401,{error:"unauthorized"});
  return {ok:false};
}
async function publishGate(req,res){
  const admin=await adminIdentity(req);
  forwardSessionCookie(res,admin);
  if(admin.ok)return {...admin,status:"published"};
  if(!PUBLISH_TOKEN){send(res,503,{error:"publishing_disabled"});return {ok:false};}
  if(!same(bearer(req),PUBLISH_TOKEN)){send(res,401,{error:"unauthorized"});return {ok:false};}
  return {ok:true,via:"publish",status:"pending"};
}
function originOk(req,res){const origin=req.headers.origin,site=String(req.headers["sec-fetch-site"]||"").toLowerCase();if((origin&&origin!==PUBLIC_ORIGIN)||site==="cross-site"){send(res,403,{error:"forbidden_origin"});return false;}return true;}
function rateOk(req,res){const ip=clientIp(req),now=Date.now();if(requests.size>4096)for(const [key,value]of requests)if(now-value.start>120000)requests.delete(key);const slot=requests.get(ip)||{start:now,count:0};if(now-slot.start>60000){slot.start=now;slot.count=0;}slot.count++;requests.set(ip,slot);if(slot.count>300){send(res,429,{error:"rate_limited"},{"retry-after":"60"});return false;}return true;}
async function bodyJson(req,res){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>524288){send(res,413,{error:"payload_too_large"});return null;}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString("utf8")||"null");}catch{send(res,400,{error:"invalid_json"});return null;}}
function contractReady(res){if(contract.info().ready)return true;send(res,503,{error:"canonical_contract_unavailable",contract:contract.info()});return false;}
async function canonicalValid(manifest,res,{invalidStatus=422}={}){const checked=await contract.validateCanonical(manifest);if(checked.ok)return true;if(checked.unavailable){send(res,503,{error:"canonical_validator_unavailable",details:checked.errors});return false;}send(res,invalidStatus,{error:"invalid_package",details:checked.errors});return false;}
const mime={".html":"text/html; charset=utf-8",".txt":"text/plain; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".ico":"image/x-icon"};
// First paint already contains the featured package (anonymous view), so the
// storefront does not shift when /api/catalog arrives (Lighthouse CLS).
const FEATURED_SLOT='<section class="featured-section" id="empfohlen" hidden>\n    <div class="container"><div id="featured"></div></div>';
function withFeatured(html){try{if(!html.includes(FEATURED_SLOT))return html;const record=registry.list({sort:"newest"}).find(entry=>entry.offer?.featured===true);if(!record)return html;const item=catalogView(record,accessFor(record,viewerPlan(null),false));return html.replace(FEATURED_SLOT,`<section class="featured-section" id="empfohlen">\n    <div class="container"><div id="featured">${featuredCardHtml(item)}</div></div>`);}catch(error){console.error(error);return html;}}
async function staticFile(pathname,res){let rel;try{rel=pathname==="/"?"index.html":pathname==="/admin"||pathname==="/admin/"?"admin.html":pathname==="/datenschutz"||pathname==="/datenschutz/"?"datenschutz.html":decodeURIComponent(pathname).replace(/^\/+/,"");}catch{return false;}const path=resolve(publicDir,rel);if(path!==publicDir&&!path.startsWith(publicDir+sep))return false;try{if(!(await stat(path)).isFile())return false;const data=rel==="index.html"?Buffer.from(withFeatured(await readFile(path,"utf8")),"utf8"):await readFile(path);res.writeHead(200,headers({"content-type":mime[extname(path)]||"application/octet-stream","content-length":data.length,"cache-control":"no-store"}));res.end(data);return true;}catch{return false;}}

// One-time purchase via Stripe Checkout (net prices, Stripe Tax, invoice for
// B2B). The purchase is recorded when the buyer returns and the server has
// verified the paid session itself; nothing is trusted from the browser.
async function stripeRequest(method,pathname,form=null){
  const response=await fetch(`https://api.stripe.com/v1${pathname}`,{method,headers:{authorization:`Bearer ${STRIPE_SECRET_KEY}`,...(form?{"content-type":"application/x-www-form-urlencoded"}:{})},body:form?new URLSearchParams(form).toString():undefined,signal:AbortSignal.timeout(10000)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(body?.error?.message||`stripe HTTP ${response.status}`),{code:"stripe_failed"});
  return body;
}
async function stripeCheckout(record,email){
  const offer=record.offer||{};
  return stripeRequest("POST","/checkout/sessions",{
    mode:"payment",
    customer_email:email,
    client_reference_id:record.manifest.id,
    success_url:`${PUBLIC_ORIGIN}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:`${PUBLIC_ORIGIN}/?checkout=cancel#${encodeURIComponent(record.manifest.id)}`,
    "line_items[0][quantity]":"1",
    "line_items[0][price_data][currency]":String(offer.currency||"EUR").toLowerCase(),
    "line_items[0][price_data][unit_amount]":String(offer.priceCents||0),
    "line_items[0][price_data][tax_behavior]":"exclusive",
    "line_items[0][price_data][product_data][name]":record.manifest.name,
    "line_items[0][price_data][product_data][description]":String(offer.tagline||record.manifest.description||"").slice(0,300)||record.manifest.name,
    "automatic_tax[enabled]":"true",
    billing_address_collection:"required",
    "tax_id_collection[enabled]":"true",
    "invoice_creation[enabled]":"true",
    "metadata[packageId]":record.manifest.id,
    "metadata[version]":record.manifest.version,
    "metadata[email]":email
  });
}
async function confirmStripeCheckout(id,email){
  const checkout=await stripeRequest("GET",`/checkout/sessions/${encodeURIComponent(id)}`);
  const packageId=String(checkout?.metadata?.packageId||""),record=registry.get(packageId);
  if(checkout?.payment_status!=="paid"||checkout?.status!=="complete")return{ok:false,error:"not_paid"};
  if(!record)return{ok:false,error:"unknown_package"};
  if(String(checkout?.metadata?.email||"").toLowerCase()!==email)return{ok:false,error:"buyer_mismatch"};
  if(Number(checkout?.amount_subtotal)!==Number(record.offer?.priceCents||0))return{ok:false,error:"amount_mismatch"};
  const purchase=await registry.addPurchase({email,packageId,source:"stripe",reference:id,priceCents:checkout.amount_subtotal,currency:String(checkout.currency||"eur").toUpperCase()});
  return{ok:true,packageId,name:record.manifest.name,purchase};
}

const server=createServer(async(req,res)=>{try{if(!rateOk(req,res))return;const url=new URL(req.url,`http://${req.headers.host||"localhost"}`),path=url.pathname;
if(req.method==="GET"&&path==="/healthz")return send(res,contract.info().ready?200:503,{ok:contract.info().ready,contract:contract.info(),packages:registry.list().length});
if(req.method==="GET"&&path==="/api/contract")return send(res,200,contract.info());
if(req.method==="GET"&&path==="/api/me"){const session=await accountSession(req);const {setCookie,...body}=session;return send(res,200,body,sessionResponseHeaders(session));}
if(req.method==="POST"&&path==="/api/logout"){if(!originOk(req,res))return;const setCookie=await accountLogout(req);return send(res,200,{ok:true},{"set-cookie":setCookie});}
if(req.method==="POST"&&path==="/api/contract/refresh"){if(!originOk(req,res)||!(await adminGate(req,res)).ok)return;const ok=await contract.refresh();return send(res,ok?200:503,contract.info());}
if(req.method==="GET"&&path==="/api/categories"){const access=await viewerGate(req,res);if(!access.ok)return;return send(res,200,{categories:visibleCategories(access.viewer)});}
if(req.method==="GET"&&path==="/api/packages"){const access=await viewerGate(req,res);if(!access.ok)return;const items=visibleRecords(access.viewer,{q:url.searchParams.get("q")||"",category:url.searchParams.get("category")||"",sort:url.searchParams.get("sort")||"newest"},access.session);return send(res,200,{packages:items.map(recordView),total:items.length});}
const manifestMatch=path.match(/^\/api\/packages\/([^/]+)\/manifest$/);if(req.method==="GET"&&manifestMatch){if(!contractReady(res))return;const access=await viewerGate(req,res);if(!access.ok)return;const r=registry.get(decodeURIComponent(manifestMatch[1]));if(!r)return send(res,404,{error:"not_found"});if(!entitled(r,access.viewer,access.session))return send(res,403,{error:"package_not_entitled"});if(!(await canonicalValid(r.manifest,res,{invalidStatus:503})))return;return send(res,200,r.manifest);}
const downloadMatch=path.match(/^\/api\/packages\/([^/]+)\/download$/);if(req.method==="POST"&&downloadMatch){if(!originOk(req,res)||!contractReady(res))return;const access=await viewerGate(req,res);if(!access.ok)return;const r=registry.get(decodeURIComponent(downloadMatch[1]));if(!r)return send(res,404,{error:"not_found"});if(!entitled(r,access.viewer,access.session))return send(res,403,{error:"package_not_entitled"});if(!(await canonicalValid(r.manifest,res,{invalidStatus:503})))return;await registry.countDownload(r.manifest.id);return send(res,200,{manifest:r.manifest});}
const detailMatch=path.match(/^\/api\/packages\/([^/]+)$/);if(req.method==="GET"&&detailMatch){const access=await viewerGate(req,res);if(!access.ok)return;const r=registry.get(decodeURIComponent(detailMatch[1]));if(!r)return send(res,404,{error:"not_found"});return !entitled(r,access.viewer,access.session)?send(res,403,{error:"package_not_entitled"}):send(res,200,recordView(r));}
if(req.method==="GET"&&path==="/api/catalog"){const session=await accountSession(req);forwardSessionCookie(res,session);const viewer=viewerPlan(session);const items=registry.list({q:url.searchParams.get("q")||"",category:url.searchParams.get("category")||"",sort:url.searchParams.get("sort")||"newest"});const view=items.map(record=>catalogView(record,accessOf(record,viewer,session)));view.sort((a,b)=>Number(b.offer.featured)-Number(a.offer.featured));const categories=new Map();for(const item of items)for(const category of item.manifest.contributes.categories){const current=categories.get(category.id)||{...category,count:0};current.count+=1;categories.set(category.id,current);}return send(res,200,{packages:view,total:view.length,categories:[...categories.values()],viewer:{authenticated:session.authenticated===true,plan:viewer,planLabel:viewer?planLabel(viewer):null},checkout:{available:Boolean(STRIPE_SECRET_KEY),orderEmail:ORDER_EMAIL}});}
if(req.method==="GET"&&path==="/api/library"){const access=await viewerGate(req,res);if(!access.ok)return;const items=registry.list().map(record=>catalogView(record,accessOf(record,access.viewer,access.session))).filter(item=>canUse(item.access));return send(res,200,{packages:items,total:items.length,storeUrl:PUBLIC_ORIGIN+"/"});}
const checkoutMatch=path.match(/^\/api\/packages\/([^/]+)\/checkout$/);if(req.method==="POST"&&checkoutMatch){if(!originOk(req,res))return;const session=await accountSession(req);forwardSessionCookie(res,session);if(!session.authenticated)return send(res,401,{error:"authentication_required"});const r=registry.get(decodeURIComponent(checkoutMatch[1]));if(!r||r.status!=="published")return send(res,404,{error:"not_found"});const access=accessOf(r,viewerPlan(session),session);if(canUse(access))return send(res,409,{error:"already_available",access});if(access!=="buyable")return send(res,409,{error:"not_buyable"});if(!STRIPE_SECRET_KEY)return send(res,503,{error:"checkout_unavailable",orderEmail:ORDER_EMAIL});const created=await stripeCheckout(r,sessionEmail(session));return send(res,200,{url:created.url});}
if(req.method==="GET"&&path==="/api/checkout/confirm"){const session=await accountSession(req);forwardSessionCookie(res,session);if(!session.authenticated)return send(res,401,{error:"authentication_required"});const id=String(url.searchParams.get("session_id")||"");if(!/^cs_[A-Za-z0-9_]{8,200}$/.test(id))return send(res,400,{error:"invalid_session"});if(!STRIPE_SECRET_KEY)return send(res,503,{error:"checkout_unavailable"});const result=await confirmStripeCheckout(id,sessionEmail(session));return send(res,result.ok?200:409,result);}
if(req.method==="POST"&&path==="/api/admin/purchases"){if(!originOk(req,res)||!(await adminGate(req,res)).ok)return;const body=await bodyJson(req,res);if(body===null)return;const email=String(body?.email||"").trim().toLowerCase(),packageId=String(body?.packageId||"");if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return send(res,422,{error:"invalid_email"});if(!registry.get(packageId))return send(res,404,{error:"not_found"});const purchase=await registry.addPurchase({email,packageId,source:"invoice",reference:String(body?.reference||`invoice:${email}:${packageId}`)});return send(res,200,{ok:true,purchase});}
if(req.method==="GET"&&path==="/api/admin/purchases"){if(!(await adminGate(req,res)).ok)return;return send(res,200,{purchases:registry.state.purchases.slice(-500).reverse()});}
if(req.method==="GET"&&path==="/api/admin/packages"){if(!(await adminGate(req,res)).ok)return;const items=registry.list({q:url.searchParams.get("q")||"",includePending:true,sort:url.searchParams.get("sort")||"newest"});return send(res,200,{packages:items.map(record=>({...recordView(record),offer:offerView(record)})),total:items.length});}
if(req.method==="POST"&&path==="/api/packages"){if(!originOk(req,res)||!contractReady(res))return;const gate=await publishGate(req,res);if(!gate.ok)return;const body=await bodyJson(req,res);if(body===null)return;const wrapped=body&&typeof body==="object"&&body.package&&body.package.schema==="preset-package/1";const manifest=wrapped?body.package:body;const plan=normalizePlan((wrapped?body.plan:body&&body.plan)||url.searchParams.get("plan"));if(!(await canonicalValid(manifest,res)))return;const previous=registry.get(manifest.id);if(previous&&previous.manifest.publisher!==manifest.publisher)return send(res,409,{error:"publisher_mismatch"});const r=await registry.upsert(manifest,gate.status,plan);return send(res,previous?200:201,{id:r.manifest.id,status:r.status,version:r.manifest.version,plan:r.plan});}
const adminMatch=path.match(/^\/api\/admin\/packages\/([^/]+)\/status$/);if(req.method==="PATCH"&&adminMatch){if(!originOk(req,res)||!(await adminGate(req,res)).ok||!contractReady(res))return;const body=await bodyJson(req,res);if(body===null)return;const id=decodeURIComponent(adminMatch[1]),r=registry.get(id);if(!r)return send(res,404,{error:"not_found"});if(body.status){const status=String(body.status);if(!["pending","published","rejected"].includes(status))return send(res,422,{error:"invalid_status"});if(!(await canonicalValid(r.manifest,res)))return;await registry.setStatus(id,status);}if(body.plan)await registry.setPlan(id,body.plan);if(body.offer&&typeof body.offer==="object")await registry.setOffer(id,body.offer);const fresh=registry.get(id);return send(res,200,{id,status:fresh.status,plan:fresh.plan,offer:fresh.offer});}
const adminItem=path.match(/^\/api\/admin\/packages\/([^/]+)$/);if(req.method==="DELETE"&&adminItem){if(!originOk(req,res)||!(await adminGate(req,res)).ok)return;const id=decodeURIComponent(adminItem[1]);const removed=await registry.remove(id);return removed?send(res,200,{id,removed:true}):send(res,404,{error:"not_found"});}

if(req.method==="POST"&&path==="/api/metrics"){if(!originOk(req,res))return;if(metricsLimited(clientIp(req)))return send(res,429,{error:"rate_limited"},{"retry-after":"60"});const body=await bodyJson(req,res);if(body===null)return;const event=String(body.event||"");if(!METRICS_ALLOWED.has(event))return send(res,400,{error:"invalid_event"});const day=new Date().toISOString().slice(0,10);await recordMetric({event,path:String(body.path||"").slice(0,200),listing_id:body.listing_id!=null?String(body.listing_id).slice(0,80):"",listing_name:body.listing_name!=null?String(body.listing_name).slice(0,120):"",cta_label:body.cta_label!=null?String(body.cta_label).slice(0,100):"",link_url:body.link_url!=null?String(body.link_url).slice(0,300):"",day,createdAt:new Date().toISOString()});res.writeHead(204,headers());return res.end();}
if(req.method==="GET"&&await staticFile(path,res))return;send(res,404,{error:"not_found"});}catch(error){console.error(error);if(!res.headersSent)send(res,500,{error:"internal_error"});else res.destroy();}});
if(process.env.NODE_ENV!=="test")server.listen(PORT,HOST,()=>{console.log(`markt listening on http://${HOST}:${PORT}`);console.log(`canonical preset contract: ${contract.info().ready?"ready":`UNAVAILABLE: ${contract.info().error}`}`);});
export{server,contract,registry};
