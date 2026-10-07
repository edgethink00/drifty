import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { runInNewContext } from "node:vm";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const destination=resolve(process.argv[2]??resolve(root,".qa-captures/browser-context-extension"));
mkdirSync(destination,{recursive:true});
const source=readFileSync(resolve(root,"browser-extension/src/collector.ts"),"utf8").replace(/^export /gm, "");
const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText.replace(/^export /gm,"");
// executeScript serializes just the function: inline all of its dependencies.
const functions={}; runInNewContext(javascript, functions);
const observer=functions.installBrowserRevisionObserver.toString();
const revision=functions.revisionOnly.toString().replace("installBrowserRevisionObserver(documentId)",`(${observer})(documentId)`);
const capture=functions.boundedCapture.toString()
  .replaceAll("revisionOnly(documentId)",`(${revision})(documentId)`)
  .replace("captureGenericBrowserContextCandidate(options)",`(${functions.captureGenericBrowserContextCandidate.toString()})(options)`)
  .replace("captureStructuredTopic(",`(${functions.captureStructuredTopic.toString()})(`);
writeFileSync(resolve(destination,"collector.js"),revision+"\n"+capture+"\n");
for(const file of ["manifest.json","worker.js"])copyFileSync(resolve(root,"browser-extension",file),resolve(destination,file));
console.log(JSON.stringify({destination,extensionId:readFileSync(resolve(root,"browser-extension/extension-id.txt"),"utf8").trim()}));
