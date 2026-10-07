export type GenericBrowserContextOptions = {
  enabled: boolean;
  privateBrowsing: boolean;
  sensitiveSurface: boolean;
  experimentalH3?: boolean;
};

export type GenericBrowserContextCandidate = {
  kind: "generic_browser_context_candidate";
  providerPolicy: "local_only";
  trust: "untrusted_page_metadata";
  status: "collected" | "empty" | "blocked";
  reason: string | null;
  description: string | null;
  visibleHeadings: string[];
  pageType: "article" | "website" | "book" | "video" | "music" | null;
  language: string | null;
  textCharacters: number;
};

// Bounded collector, run only in a browser-owned isolated main-frame context.
// The build script inlines dependencies for chrome.scripting serialization.
export function captureGenericBrowserContextCandidate(options: GenericBrowserContextOptions): GenericBrowserContextCandidate {
  const result: GenericBrowserContextCandidate = {
    kind: "generic_browser_context_candidate", providerPolicy: "local_only", trust: "untrusted_page_metadata",
    status: "blocked", reason: null, description: null, visibleHeadings: [], pageType: null, language: null, textCharacters: 0,
  };
  if (!options.enabled) { result.reason = "disabled"; return result; }
  if (options.privateBrowsing || options.sensitiveSurface) { result.reason = "private_or_sensitive"; return result; }
  const doc = document;
  const view = doc.defaultView;
  if (!view || doc.visibilityState !== "visible") { result.reason = "inactive_document"; return result; }
  const url = new URL(doc.URL);
  if (!/^https?:$/.test(url.protocol)) { result.reason = "unsupported_url"; return result; }
  // Conservative exclusions. They do not identify every sensitive page.
  if (/(?:^|\/)(?:login|signin|sign-in|auth|oauth|checkout|billing|payment|account|profile)(?:\/|$)/i.test(url.pathname)
    || doc.querySelector('input[type="password" i], input[autocomplete~="cc-number" i], input[autocomplete~="cc-csc" i]')) {
    result.reason = "sensitive_surface"; return result;
  }
  if (doc.querySelector('[contenteditable]:not([contenteditable="false" i]), textarea')) {
    result.reason = "editable_surface"; return result;
  }

  function clean(value: string | null, cap: number): string {
    return (value ?? "").replace(/\s+/g, " ").trim().slice(0, cap);
  }
  function headingText(root: Element, cap: number): string {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let value = "", inspectedText = 0, text: Node | null;
    while ((text = walker.nextNode()) && ++inspectedText <= 24 && value.length < cap) {
      let parent = text.parentElement;
      if (!parent || parent.closest('script, style, [hidden], [inert], [aria-hidden="true"]')) continue;
      let reachesRoot = false, hidden = false;
      for (let depth = 0; parent && depth < 8; depth++, parent = parent.parentElement) {
        const style = view!.getComputedStyle(parent);
        if (style.display === "none" || style.visibility !== "visible" || style.opacity === "0") { hidden = true; break; }
        if (parent === root) { reachesRoot = true; break; }
      }
      if (hidden || !reachesRoot) continue;
      const piece = clean((text as Text).substringData(0, cap), cap);
      if (!piece) continue;
      const separator = value ? " " : "";
      value += separator + piece.slice(0, Math.max(0, cap - value.length - separator.length));
    }
    return clean(value, cap);
  }
  const title = clean(doc.title, 500).toLocaleLowerCase();
  let remaining = 240;
  const description = clean(
    doc.head?.querySelector('meta[name="description" i]')?.getAttribute("content")
      || doc.head?.querySelector('meta[property="og:description" i]')?.getAttribute("content") || null, 160);
  if (description && description.toLocaleLowerCase() !== title) {
    result.description = description;
    remaining -= description.length;
  }

  const headingSelector = options.experimentalH3 ? "h1, h2, h3" : "h1, h2";
  const main = doc.querySelector('main, article, [role="main"]');
  // Some LMS layouts expose an empty main landmark beside the actual content.
  const scope = main?.querySelector(headingSelector) ? main : doc;
  let inspected = 0;
  for (const node of scope.querySelectorAll(headingSelector)) {
    if (++inspected > 32 || result.visibleHeadings.length >= 3 || remaining <= 0) break;
    if (node.closest('nav, header, footer, dialog, [role="dialog"], [hidden], [inert], [aria-hidden="true"]')) continue;
    const aside = node.closest("aside");
    // Some public LMS templates put their primary landing content in an aside.
    // In fallback mode only, admit a viewport-dominant region; narrow sidebars
    // remain excluded. This is a layout heuristic, not a privacy detector.
    if (aside && (scope !== doc || aside.getBoundingClientRect().width < view.innerWidth * 0.5)) continue;
    let ancestor: Element | null = node, visible = true, reachesDocument = false;
    for (let depth = 0; ancestor && depth < 32; depth++, ancestor = ancestor.parentElement) {
      const style = view.getComputedStyle(ancestor);
      if (style.display === "none" || style.visibility !== "visible" || style.opacity === "0") { visible = false; break; }
      if (ancestor === doc.documentElement) { reachesDocument = true; break; }
    }
    if (!visible || !reachesDocument) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1 || rect.bottom <= 0 || rect.top >= view.innerHeight
      || rect.right <= 0 || rect.left >= view.innerWidth) continue;
    const value = headingText(node, Math.min(80, remaining));
    if (!value || title.includes(value.toLocaleLowerCase()) || result.visibleHeadings.includes(value)) continue;
    result.visibleHeadings.push(value);
    remaining -= value.length;
  }

  const ogType = clean(doc.head?.querySelector('meta[property="og:type" i]')?.getAttribute("content") ?? null, 40).toLowerCase();
  if (ogType === "article" || ogType === "website" || ogType === "book") result.pageType = ogType;
  else if (ogType.startsWith("video.")) result.pageType = "video";
  else if (ogType.startsWith("music.")) result.pageType = "music";
  const lang = clean(doc.documentElement.lang, 35);
  if (/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(lang)) result.language = lang;
  result.textCharacters = 240 - remaining;
  result.status = result.description || result.visibleHeadings.length || result.pageType ? "collected" : "empty";
  result.reason = result.status === "empty" ? "no_additional_context" : null;
  return result;
}

type CurrentTopicCandidate = {kind:"visible_topic_candidate";providerPolicy:"local_only";trust:"untrusted_visible_text";status:"blocked"|"empty"|"collected";reason:string|null;snippets:string[];textCharacters:number;inspectedNodes:number};
export type StructuredTopicCandidate = CurrentTopicCandidate & {
  structure: "visible_blocks_v1";
  selectedScope: "landmark" | "body" | null;
  inspectedGroups: number;
};

// Site-agnostic structure only, no keywords, model confidence or semantic labels.
// Up to 512 DOM visits /32 bounded groups /240 UTF-16 units per transient group.
// The native capture uses four 60-unit snippets /240 units in total.
export function captureStructuredTopic(options: GenericBrowserContextOptions & { existingText: string[] }, budget: 120 | 240 = 120): StructuredTopicCandidate {
  if (budget !== 120 && budget !== 240) throw Error("Unsupported bounded text budget");
  const maxSnippets = budget === 240 ? 4 : 3;
  const result:StructuredTopicCandidate={kind:"visible_topic_candidate",providerPolicy:"local_only",trust:"untrusted_visible_text",status:"blocked",reason:null,snippets:[],textCharacters:0,inspectedNodes:0,structure:"visible_blocks_v1",selectedScope:null,inspectedGroups:0};
  if(!options.enabled){result.reason="disabled";return result;}
  if(options.privateBrowsing||options.sensitiveSurface){result.reason="private_or_sensitive";return result;}
  const doc=document,view=doc.defaultView;
  if(!view||doc.visibilityState!=="visible"){result.reason="inactive_document";return result;}
  const url=new URL(doc.URL);
  if(!/^https?:$/.test(url.protocol)){result.reason="unsupported_url";return result;}
  if(/(?:^|\/)(?:login|signin|sign-in|auth|oauth|checkout|billing|payment|account|profile)(?:\/|$)/i.test(url.pathname)
    ||doc.querySelector('input[type="password" i],input[autocomplete~="cc-number" i],input[autocomplete~="cc-csc" i]')){result.reason="sensitive_surface";return result;}
  if(doc.querySelector('[contenteditable]:not([contenteditable="false" i]),textarea')){result.reason="editable_surface";return result;}
  if(!doc.body){result.status="empty";result.reason="no_visible_topic";return result;}
  const clean=(s:string)=>s.replace(/\s+/g," ").trim();
  const existing=[doc.title,...options.existingText].map(s=>clean(s).toLocaleLowerCase());
  const excluded='script,style,noscript,template,nav,header,footer,dialog,[role="dialog"],form,input,textarea,select,button,label,h1,h2,h3,h4,h5,h6,[contenteditable]:not([contenteditable="false" i]),[hidden],[inert],[aria-hidden="true"]';
  type Group={owner:Element;text:string;landmark:boolean;paragraph:boolean;prominent:boolean;cutTail:boolean;order:number};
  const baseFont=parseFloat(view.getComputedStyle(doc.body).fontSize)||16;
  const groups=new Map<Element,Group>();
  const budgetStop={};
  const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{
    acceptNode(node:Node){
      if(result.inspectedNodes>=512)throw budgetStop;
      result.inspectedNodes++;
      if(node.nodeType===Node.ELEMENT_NODE){
        const element=node as Element;
        if(element.matches(excluded))return NodeFilter.FILTER_REJECT;
        const style=view!.getComputedStyle(element);
        if(style.display==="none"||style.visibility!=="visible"||style.opacity==="0")return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node:Node|null;
  try{
  while(result.inspectedNodes<512&&(node=walker.nextNode())){
    if(node.nodeType!==Node.TEXT_NODE){
      if(node.nodeName==="BR")for(const group of groups.values())if(group.owner.contains(node))group.text=(group.text+" ").slice(0,240);
      continue;
    }
    const parent=node.parentElement;
    if(!parent||parent.closest(excluded))continue;
    const landmark=parent.closest('main,article,[role="main"]');
    const aside=parent.closest("aside");
    if(aside&&(landmark||aside.getBoundingClientRect().width<view.innerWidth*0.5))continue;
    let owner:Element|null=null,ancestor:Element|null=parent,visible=true,reachesDocument=false;
    for(let depth=0;ancestor&&depth<32;depth++,ancestor=ancestor.parentElement){
      const style=view.getComputedStyle(ancestor);
      if(style.display==="none"||style.visibility!=="visible"||style.opacity==="0"){visible=false;break;}
      if(!owner&&style.display!=="inline"&&style.display!=="contents")owner=ancestor;
      if(ancestor===doc.documentElement){reachesDocument=true;break;}
    }
    if(!visible||!reachesDocument||!owner)continue;
    // Standalone links are excluded; inline links inside prose/list/table blocks
    // can provide missing words without reading target URLs or field values.
    if(parent.closest("a")&&!parent.closest("p,li,dt,dd,blockquote,figcaption,td,th"))continue;
    let group=groups.get(owner);
    if(!group&&groups.size>=32)continue;
    const remaining=240-(group?.text.length??0);
    if(remaining<=0)continue;
    const text=node as Text,length=Math.min(remaining,text.length);
    if(!length)continue;
    const range=doc.createRange();range.setStart(text,0);range.setEnd(text,length);
    const rect=range.getBoundingClientRect();
    if(rect.width<=1||rect.height<=1||rect.bottom<=0||rect.top>=view.innerHeight||rect.right<=0||rect.left>=view.innerWidth)continue;
    const value=text.substringData(0,length);
    const prominent=(parseFloat(view.getComputedStyle(parent).fontSize)||baseFont)>=baseFont*1.2;
    if(!group){group={owner,text:"",landmark:Boolean(landmark),paragraph:owner.matches("p,li,dt,dd,blockquote,figcaption,td,th"),prominent,cutTail:false,order:groups.size};groups.set(owner,group);}
    group.prominent ||= prominent;
    // Preserve original whitespace across inline nodes and explicit BR separators.
    group.text+=value;
    group.text=group.text.slice(0,240);
    group.cutTail=text.length>length&&/\S$/.test(value)&&/\S/.test(text.substringData(length,1));
  }
  }catch(error){if(error!==budgetStop)throw error;}
  result.inspectedNodes=Math.min(result.inspectedNodes,512);result.inspectedGroups=groups.size;
  const ordered=[...groups.values()].sort((a,b)=>Number(b.landmark)-Number(a.landmark)||Number(b.prominent)-Number(a.prominent)||Number(b.paragraph)-Number(a.paragraph)||a.order-b.order);
  let remaining=budget;
  for(const group of ordered){
    if(!remaining||result.snippets.length>=maxSnippets)break;
    let value=clean(group.text);
    if(group.cutTail){const boundary=value.lastIndexOf(" ");if(boundary>=0)value=value.slice(0,boundary);}
    if(!value)continue;
    const lower=value.toLocaleLowerCase();
    if(existing.some(s=>s.includes(lower)))continue;
    // Exact lexical prefix overlap is removed only if it ends at whitespace;
    // meanings, punctuation, command words and topics are never interpreted.
    let overlap=0;
    for(const s of existing){
      for(let n=Math.min(s.length,lower.length);n>=16;n--){
        if((n===lower.length||/\s/.test(value[n]))&&s.includes(lower.slice(0,n))){overlap=Math.max(overlap,n);break;}
      }
    }
    if(overlap)value=value.slice(overlap).trim();
    if(!value)continue;
    while(value&&remaining&&result.snippets.length<maxSnippets){
      const cap=Math.min(60,remaining);
      const cut=value.length>cap?value.lastIndexOf(" ",cap):-1;
      // A short final remainder cannot hold the next word. Do not emit its
      // first letters. Full60-unit unspaced strings retain the documented cap.
      if(value.length>cap&&cut<1&&cap<60)break;
      const length=value.length<=cap?value.length:cut>=1?cut:cap;
      const piece=value.slice(0,length).trim();value=value.slice(length).trim();
      if(!piece||existing.some(s=>s.includes(piece.toLocaleLowerCase()))||result.snippets.includes(piece))continue;
      result.snippets.push(piece);remaining-=piece.length;result.selectedScope??=group.landmark?"landmark":"body";
    }
  }
  result.textCharacters=budget-remaining;result.status=result.snippets.length?"collected":"empty";
  result.reason=result.status==="empty"?"no_visible_topic":null;return result;
}

export type DocumentRevision = {
  documentId: string;
  revision: number;
  visible: boolean;
  pageFocused: boolean;
  lastChange?: string;
};

// Runs in the extension's isolated world. A DOM observer alone does not
// establish native OS foreground authority; the native host verifies that.
// Mutation records are counted and discarded; no node text/attribute values,
// form values, history state, iframe or shadow-root contents are returned.
export function installBrowserRevisionObserver(callerDocumentId?: string): () => DocumentRevision {
  // The extension supplies the browser API document ID, including HTTP pages
  // where randomUUID is unavailable. Page-controlled IDs are not authority.
  const documentId = callerDocumentId ?? crypto.randomUUID();
  let revision = 0;
  let lastUrl = document.URL;
  let lastChange = "installed";
  const advance = (reason: string) => { lastChange = reason; revision = revision >= Number.MAX_SAFE_INTEGER ? NaN : revision + 1; };
  const observer = new MutationObserver(records => { if (records.length) advance("mutation_batch"); });
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  for (const event of ["visibilitychange", "focus", "blur", "pageshow", "pagehide", "popstate", "hashchange", "scroll", "resize"]) {
    window.addEventListener(event, () => advance(event), { capture: true, passive: true });
  }
  return () => {
    if (observer.takeRecords().length) advance("pending_mutation_batch");
    if (document.URL !== lastUrl) { lastUrl = document.URL; advance("url_change"); }
    return { documentId, revision, visible: document.visibilityState === "visible", pageFocused: document.hasFocus(), lastChange };
  };
}


export function revisionOnly(documentId: string) {
  const g=globalThis as typeof globalThis & {__driftyContextRevision?:()=>DocumentRevision};
  if (!g.__driftyContextRevision) Object.defineProperty(g,"__driftyContextRevision",{value:installBrowserRevisionObserver(documentId),writable:false,configurable:false});
  return g.__driftyContextRevision!();
}
export function boundedCapture(documentId: string) {
  const before=revisionOnly(documentId);
  const options={enabled:true,privateBrowsing:false,sensitiveSurface:false,experimentalH3:true};
  const candidate=captureGenericBrowserContextCandidate(options);
  const topic=captureStructuredTopic({...options,existingText:[candidate.description??"",...candidate.visibleHeadings]},240);
  const after=revisionOnly(documentId);
  return {before,after,url:document.URL,title:document.title,clues:{...(candidate.description?{description:candidate.description}:{}),...(candidate.visibleHeadings.length?{headings:candidate.visibleHeadings}:{}),...(topic.snippets.length?{visibleTopic:topic.snippets}:{})}};
}
