/* Page messages are never forwarded. Only a native capture request reads DOM. */
importScripts("collector.js");
const workerEpoch = crypto.randomUUID();
let revision = 0;
const bump = () => { revision++; };
chrome.tabs.onActivated.addListener(bump);
chrome.tabs.onRemoved.addListener(bump);
chrome.windows.onFocusChanged.addListener(bump);
chrome.webNavigation.onCommitted.addListener(d => { if (d.frameId === 0) bump(); });
chrome.webNavigation.onHistoryStateUpdated.addListener(d => { if (d.frameId === 0) bump(); });
chrome.permissions.onRemoved.addListener(bump);
let port;
async function identity() {
  const tabs = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if (tabs.length !== 1) throw Error("ambiguous_active_tab");
  const tab=tabs[0], win=await chrome.windows.get(tab.windowId);
  const url=new URL(tab.url || "about:blank");
  // Message and editor bodies remain excluded. URL/DOM exclusions are conservative.
  const excludedHost=/(^|\.)(slack\.com|discord\.com|whatsapp\.com|telegram\.org|messenger\.com|mail\.google\.com|outlook\.live\.com|outlook\.office\.com|teams\.microsoft\.com|chatgpt\.com|claude\.ai|notion\.so|docs\.google\.com)$/i.test(url.hostname);
  const sensitive=excludedHost || /(?:^|\/)(?:login|signin|sign-in|auth|oauth|checkout|billing|payment|account|profile|messages|inbox|chat)(?:\/|$)/i.test(url.pathname);
  const permission=/^https?:$/.test(url.protocol) && await chrome.permissions.contains({origins:[url.origin+"/*"]});
  const frame=await chrome.webNavigation.getFrame({tabId:tab.id,frameId:0});
  if (!frame) throw Error("missing_document_identity");
  const value={workerEpoch,revision,tabId:tab.id,windowId:win.id,documentId:frame.documentId,lifecycle:frame.documentLifecycle,
    focused:win.focused,incognito:Boolean(tab.incognito||win.incognito),permission,sensitive,url:tab.url,title:tab.title,
    bounds:{left:win.left,top:win.top,width:win.width,height:win.height}};
  if(value.incognito||value.sensitive||!value.permission||!value.focused||value.lifecycle!=="active") throw Error("document_not_admitted");
  return value;
}
async function execute(id,func) {
  const rows=await chrome.scripting.executeScript({target:{tabId:id.tabId,documentIds:[id.documentId]},world:"ISOLATED",func,args:[id.documentId]});
  if(rows.length!==1||rows[0].frameId!==0||rows[0].documentId!==id.documentId) throw Error("wrong_document");
  return rows[0].result;
}
async function handle(message) {
  if(!message||!/^[a-f0-9]{32}$/.test(message.requestId)||!['capture','current'].includes(message.kind)) throw Error("invalid_native_request");
  const before=await identity();
  if(message.kind==='current') return {identity:before,dom:await execute(before,revisionOnly),after:await identity()};
  const dom=await execute(before,boundedCapture);
  return {before,after:await identity(),dom};
}
function connect() {
  if(port)return;
  try { port=chrome.runtime.connectNative("so.drifty.browser_context"); }
  catch { return; }
  const owned=port;
  owned.onMessage.addListener(message=>{
    handle(message).then(result=>owned.postMessage({requestId:message.requestId,result}),()=>owned.postMessage({requestId:message.requestId,error:"capture_unavailable"}));
  });
  owned.onDisconnect.addListener(()=>{ void chrome.runtime.lastError; if(port===owned)port=null; });
}
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();

chrome.alarms.create("reconnect",{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==="reconnect")connect();});
