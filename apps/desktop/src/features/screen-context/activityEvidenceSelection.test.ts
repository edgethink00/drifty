import { buildSync } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe,expect,it } from "vitest";
const source=buildSync({entryPoints:[fileURLToPath(new URL("./activityEvidenceSelection.ts",import.meta.url))],bundle:true,platform:"node",format:"cjs",write:false,alias:{"@drifty/domain":fileURLToPath(new URL("../../../../../packages/domain/src/index.ts",import.meta.url))}}).outputFiles[0].text;
function probe(zone:string,day:string,start:number,end:number,boundary:number,rows:readonly Record<string,unknown>[]) {
  const child=spawnSync(process.execPath,["-e",source+"\nconsole.log(JSON.stringify(module.exports.activityEvidenceSelection("+JSON.stringify(rows)+","+JSON.stringify(day)+","+start+","+end+","+boundary+")));"],{env:{...process.env,TZ:zone},encoding:"utf8",timeout:2000});
  expect(child.error).toBeUndefined();expect(child.status,child.stderr).toBe(0);return JSON.parse(child.stdout);
}
const row=(id:string,startedAt:string,endedAt:string,extra={})=>({id,startedAt,endedAt,durationSeconds:(Date.parse(endedAt)-Date.parse(startedAt))/1000,appName:"Owned Editor",platform:"macos",source:"accessibility",...extra});
describe("activity evidence drawing selection",()=>{
  it("clips one long local record to the selected adjacent card, with canonical IDs only",()=>{
    const rows=[row("1","2026-10-20T09:00:00+09:00","2026-10-20T12:00:00+09:00"),row("sync:2","2026-10-20T09:00:00+09:00","2026-10-20T12:00:00+09:00",{deviceId:"foreign-device"})];
    expect(probe("Asia/Seoul","2026-10-20",600,615,0,rows)).toEqual({recordIds:["1"],windows:[[Date.parse("2026-10-20T10:00:00+09:00"),Date.parse("2026-10-20T10:15:00+09:00")]]});
    expect(probe("Asia/Seoul","2026-10-20",600,615,0,[{...rows[0],id:"01"}])).toBeNull();
    expect(probe("Asia/Seoul","2026-10-20",600,615,0,[{...rows[0],deviceId:"foreign-device"}])).toBeNull();
  });
  it("retains two real fall-back occurrences as disjoint windows and invents no spring gap",()=>{
    const fold=probe("America/New_York","2026-11-01",70,80,0,[row("1","2026-11-01T00:00:00-04:00","2026-11-01T03:00:00-05:00")]);
    expect(fold.windows).toEqual([[Date.parse("2026-11-01T01:10:00-04:00"),Date.parse("2026-11-01T01:20:00-04:00")],[Date.parse("2026-11-01T01:10:00-05:00"),Date.parse("2026-11-01T01:20:00-05:00")]]);
    expect(probe("America/New_York","2026-03-08",130,140,0,[row("1","2026-03-08T01:00:00-05:00","2026-03-08T04:00:00-04:00")])).toBeNull();
  });
  it("uses the configured logical day before midnight rollover and refuses overflow instead of truncating",()=>{
    const rows=[row("1","2026-10-21T02:55:00+09:00","2026-10-21T03:05:00+09:00")];
    expect(probe("Asia/Seoul","2026-10-20",1380,1395,240,rows).windows).toEqual([[Date.parse("2026-10-21T03:00:00+09:00"),Date.parse("2026-10-21T03:05:00+09:00")]]);
    expect(probe("Asia/Seoul","2026-10-20",1380,1395,240,Array.from({length:65},(_,i)=>({...rows[0],id:String(i+1)})))).toBeNull();
  });
});

describe("absolute panel evidence stretch",()=>{
  it("uses the selected local rows and preserves gaps inside the larger drawn card",async()=>{
    const {activityEvidenceSelectionForStretch}=await import("./activityEvidenceSelection");
    const rows=[row("1","2026-10-20T10:00:00Z","2026-10-20T10:03:00Z"),row("2","2026-10-20T10:15:00Z","2026-10-20T10:30:00Z"),row("3","2026-10-20T10:00:00Z","2026-10-20T10:30:00Z",{deviceId:"remote"})];
    expect(activityEvidenceSelectionForStretch(rows as import("@drifty/domain").ActivitySegment[],Date.parse("2026-10-20T10:01:00Z"),Date.parse("2026-10-20T10:25:00Z"))).toEqual({recordIds:["1","2"],windows:[[Date.parse("2026-10-20T10:01:00Z"),Date.parse("2026-10-20T10:03:00Z")],[Date.parse("2026-10-20T10:15:00Z"),Date.parse("2026-10-20T10:25:00Z")]]});
  });
  it("refuses invalid bounds or too many selected local rows instead of widening or truncating",async()=>{
    const {activityEvidenceSelectionForStretch}=await import("./activityEvidenceSelection");
    const one=row("1","2026-10-20T10:00:00Z","2026-10-20T10:30:00Z") as import("@drifty/domain").ActivitySegment;
    expect(activityEvidenceSelectionForStretch([one],NaN,Date.parse(one.endedAt!))).toBeNull();
    expect(activityEvidenceSelectionForStretch([one],2,1)).toBeNull();
    expect(activityEvidenceSelectionForStretch(Array.from({length:65},(_,i)=>({...one,id:String(i+1)})),Date.parse(one.startedAt),Date.parse(one.endedAt!))).toBeNull();
  });
});

describe("carried source ranges", () => {
  it("reclamps an old card to the current selected local row and refuses malformed bounds", async () => {
    const { activityEvidenceSelectionForSourceRanges } = await import("./activityEvidenceSelection");
    const current = row("1", "2026-10-20T10:10:00Z", "2026-10-20T10:20:00Z") as import("@drifty/domain").ActivitySegment;
    const ranges = [{ segmentId: "1", startMs: Date.parse("2026-10-20T10:00:00Z"), endMs: Date.parse("2026-10-20T10:30:00Z") },
      { segmentId: "2", startMs: Date.parse("2026-10-20T10:30:00Z"), endMs: Date.parse("2026-10-20T11:00:00Z") }];
    expect(activityEvidenceSelectionForSourceRanges([current], ranges)).toEqual({ recordIds: ["1"], windows: [[Date.parse(current.startedAt), Date.parse(current.endedAt!)]] });
    expect(activityEvidenceSelectionForSourceRanges([{ ...current, deviceId: "other-computer" }], ranges)).toBeNull();
    expect(activityEvidenceSelectionForSourceRanges([current], [{ ...ranges[0], startMs: NaN }])).toBeNull();
    expect(activityEvidenceSelectionForSourceRanges([current], [])).toBeNull();
  });
});
