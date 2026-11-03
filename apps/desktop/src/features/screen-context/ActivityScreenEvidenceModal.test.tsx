// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { WeekActivityInspector, type ActivityInspectorEvent } from "../dashboard/WeekActivityInspector";
import { ActivityScreenEvidenceModal } from "./ActivityScreenEvidenceModal";
import { ScreenReplayViewer } from "./ScreenReplayViewer";
import { ActivityInspectionProvider, useActivityInspection } from "../dashboard/ActivityInspectionContext";
import { ScreenEvidenceContext } from "./ScreenEvidenceContext";
import { ScreenContextClient, type ScreenContextInvoke } from "./screenContextClient";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
const LEASE="a9db1b29-80fb-4104-9272-46e0845a4774";
const FIRST="c65b878f-5e63-40c6-9b2d-8a5c444026f0",SECOND="f26d8c10-cb09-4c98-a3e3-3744216aab1e";
const selection={recordIds:["1"],windows:[[1000,2000] as const]};
const clients:ScreenContextClient[]=[];
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.dispose());document.querySelectorAll('[data-evidence-test-anchor]').forEach(node=>node.remove());vi.restoreAllMocks();});
function fixture(mode:"saved"|"empty"|"error"="saved",firstText="OWNED_FIRST_TEXT",observedTimes?:readonly [number,number]) {
  const now=Date.now();let fail=mode==="error";
  let removed:string|null=null;
  const invoke=vi.fn<ScreenContextInvoke>(async(command,args)=>{
    if(command==="screen_context_revoke_account")return;
    if(command==="screen_context_bind_account")return {leaseId:LEASE,value:{mode:"local",expiresAtMs:Date.now()+900000}};
    if(command==="screen_context_list_activity_evidence"||command==="screen_context_list_evidence"){
      if(fail){fail=false;throw "screen_context_unavailable";}
      return {leaseId:LEASE,value:{records:mode==="empty"?[]:[FIRST,SECOND].filter(id=>id!==removed).map((id,i)=>({id,observedAtMs:observedTimes?.[id===FIRST?0:1]??now+i,expiresAtMs:now+60000,textSource:"accessibility",textState:"recognized",frameRetained:false})),nextCursor:null}};
    }
    if(command==="screen_context_read_evidence")return {leaseId:LEASE,value:{id:args?.recordId,observedAtMs:now,expiresAtMs:now+60000,textEvidence:{source:"accessibility",state:"recognized",text:args?.recordId===FIRST?firstText:"OWNED_SECOND_TEXT"},frameUrl:null}};
    if(command==="screen_context_delete_evidence"){removed=String(args?.recordId);return {leaseId:LEASE,value:{removedCount:1,pendingFiles:0}};}
    if(command==="screen_context_get_status")return {leaseId:LEASE,value:{preferences:{enabled:true,replayEnabled:true,visibleTextEnabled:true,ocrEnabled:false,allowedApps:["textedit"],intervalSeconds:10},preferencesInvalid:false,captureEnabled:true,helperInstalled:true,globalPaused:false,ocrSupported:true,supportedApps:[{id:"textedit",name:"TextEdit"}],paused:removed!==null,running:true,preparing:false,accepted:2,dropped:0,lastFailure:null,lastAcceptedAtMs:now}};
    throw new Error("Unexpected optional view command");
  });
  // Recording was used before, so the app binds the account and activity detail can show the saved screen.
  const client=new ScreenContextClient(invoke,true);client.setAccount(null);void client.connect().catch(()=>undefined);clients.push(client);return {client,invoke};
}
const PREVIEW=/^See the screen again/;
const lastCall=(invoke:ReturnType<typeof fixture>["invoke"],command:string)=>invoke.mock.calls.filter(([name])=>name===command).slice(-1)[0]?.[1];
function InspectionPanel() {
  const { registerPanel } = useActivityInspection();
  return <div ref={registerPanel} data-testid="inspection-panel" />;
}
it("keeps Windows accessibility text lines and blank lines readable in activity replay",async()=>{
  const {client}=fixture("saved","Drifty capture and replay QA\r검토 중: 화면 기록 열기\r\n\r\n  Next: verify focus.\nDraft notes only.");
  const {container}=render(<LocalizationTestProvider language="en"><ActivityScreenEvidenceModal client={client} selection={selection} activityLabel="Owned Notepad activity" onClose={()=>{}} onInvalidated={()=>{}}/></LocalizationTestProvider>);
  await waitFor(()=>expect(container.querySelector("pre")?.textContent).toBe("Drifty capture and replay QA\n검토 중: 화면 기록 열기\n\n  Next: verify focus.\nDraft notes only."));
});
it.each(["recent","activity"] as const)("shows calendar dates for %s screens spanning midnight",async(kind)=>{
  const first=new Date(2026,9,25,10,3,15).getTime(),last=new Date(2026,9,26,9,55,34).getTime();
  vi.spyOn(Date,"now").mockReturnValue(last+5000);
  const {client}=fixture("saved","OWNED_FIRST_TEXT",[first,last]);
  const {container}=render(<LocalizationTestProvider language="en"><ScreenReplayViewer client={client}
    source={kind==="recent"?{kind:"recent"}:{kind:"activity",selection}} title="Owned screens" onClose={()=>{}} onInvalidated={()=>{}}/></LocalizationTestProvider>);
  await screen.findByText(kind==="recent"?"OWNED_SECOND_TEXT":"OWNED_FIRST_TEXT");
  const edges=container.querySelectorAll(".screen-replay__edge");
  expect(edges[0]?.textContent).toContain("Oct 25");expect(edges[1]?.textContent).toContain("Oct 26");
  expect(container.querySelector(".screen-replay__position time")?.textContent).toContain(kind==="recent"?"Oct 26":"Oct 25");
  expect(screen.getByRole("slider",{name:"Saved times"}).getAttribute("aria-valuetext")).toContain(kind==="recent"?"Oct 26":"Oct 25");
});
it("names both years when recent screens cross New Year",async()=>{
  const first=new Date(2026,11,31,23,59,30).getTime(),last=new Date(2027,0,1,0,0,5).getTime();
  vi.spyOn(Date,"now").mockReturnValue(last+5000);
  const {client}=fixture("saved","OWNED_FIRST_TEXT",[first,last]);
  const {container}=render(<LocalizationTestProvider language="en"><ScreenReplayViewer client={client} source={{kind:"recent"}}
    title="Owned screens" onClose={()=>{}} onInvalidated={()=>{}}/></LocalizationTestProvider>);
  await screen.findByText("OWNED_SECOND_TEXT");
  const edges=container.querySelectorAll(".screen-replay__edge");
  expect(edges[0]?.textContent).toMatch(/Dec 31.*2026/);expect(edges[1]?.textContent).toMatch(/Jan 1.*2027/);
  expect(container.querySelector(".screen-replay__position time")?.textContent).toContain("2027");
});
it.each([
  ["flow", "popover"], ["week", "popover"], ["flow", "panel"], ["week", "panel"],
] as const)("opens one modal from %s/%s and returns focus to the same activity inspector",async(surface,presentation)=>{
  const {client,invoke}=fixture();const anchor=document.createElement("button");anchor.dataset.evidenceTestAnchor="true";document.body.append(anchor);
  const close=vi.fn();const event:ActivityInspectorEvent={id:"owned-selection",surface,segmentIds:["1"],appName:"Owned Editor",category:"workspace",productivity:"focus",startLabel:"10:00",endLabel:"10:15",identities:[],hasMixedCategory:false,hasMixedProductivity:false,screenEvidenceSelection:selection};
  render(<LocalizationTestProvider language="en"><ScreenEvidenceContext.Provider value={client}><ActivityInspectionProvider options={{ presentation, hover: "off" }} scopeKey="owned-evidence-selection" onRequestOpen={()=>{}}><InspectionPanel/><WeekActivityInspector event={event} segments={[{id:"1",startedAt:"2026-10-20T10:00:00Z",endedAt:"2026-10-20T10:15:00Z",durationSeconds:900,appName:"Owned Editor",source:"accessibility",platform:"macos"}]} appIcons={{}} anchorElement={anchor} onClose={close}/></ActivityInspectionProvider></ScreenEvidenceContext.Provider></LocalizationTestProvider>);
  fireEvent.click(await screen.findByRole("button",{name:PREVIEW}));
  await screen.findByText("OWNED_FIRST_TEXT");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(document.querySelector(".week-activity-inspector")).toBeNull();
  expect(lastCall(invoke,"screen_context_list_activity_evidence")).toMatchObject({recordIds:["1"],windows:[[1000,2000]]});
  fireEvent.click(screen.getByRole("button",{name:"Next screen"}));await screen.findByText("OWNED_SECOND_TEXT");expect(screen.queryByText("OWNED_FIRST_TEXT")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Close"}));
  const entry=await screen.findByRole("button",{name:PREVIEW});await waitFor(()=>expect(document.activeElement).toBe(entry));
  expect(screen.queryByText("OWNED_SECOND_TEXT")).toBeNull();expect(close).not.toHaveBeenCalled();
  fireEvent.click(entry);await screen.findByText("OWNED_FIRST_TEXT");
  fireEvent.keyDown(document,{key:"Escape"});await screen.findByRole("button",{name:PREVIEW});
  expect(invoke.mock.calls.some(([name])=>name.includes("configure")||name.includes("delete")||name.includes("permission"))).toBe(false);
});
it("shows empty/error recovery without enabling capture or exposing late content after invalidation",async()=>{
  const {client,invoke}=fixture("error");const invalidated=vi.fn();
  render(<LocalizationTestProvider language="en"><ActivityScreenEvidenceModal client={client} selection={selection} activityLabel="Owned activity" onClose={()=>{}} onInvalidated={invalidated}/></LocalizationTestProvider>);
  await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"Try again"}));await screen.findByText("OWNED_FIRST_TEXT");
  act(()=>client.invalidate());
  expect(screen.queryByText("OWNED_FIRST_TEXT")).toBeNull();expect(invalidated).toHaveBeenCalled();
  expect(invoke.mock.calls.some(([name])=>name.includes("configure")||name.includes("permission"))).toBe(false);
});

it("labels Week evidence with its queried source times instead of the rounded chart start", async () => {
  const { client, invoke } = fixture();
  const anchor = document.createElement("button"); anchor.dataset.evidenceTestAnchor = "true"; document.body.append(anchor);
  const start = new Date("2026-10-22T01:11:34.644").getTime(), end = new Date("2026-10-22T01:12:49.644").getTime();
  const event: ActivityInspectorEvent = { id: "rounded-week", surface: "week", segmentIds: ["1"], appName: "Owned Editor",
    category: "workspace", productivity: "neutral", startLabel: "1:12 AM", endLabel: "1:13 AM", identities: [],
    hasMixedCategory: false, hasMixedProductivity: false, screenEvidenceSelection: { recordIds: ["1"], windows: [[start, end]] } };
  render(<LocalizationTestProvider language="en"><ScreenEvidenceContext.Provider value={client}>
    <WeekActivityInspector event={event} segments={[]} appIcons={{}} anchorElement={anchor} onClose={() => {}} />
  </ScreenEvidenceContext.Provider></LocalizationTestProvider>);
  fireEvent.click(await screen.findByRole("button", { name: PREVIEW }));
  await screen.findByText("OWNED_FIRST_TEXT");
  // The viewer titles the activity and shows its queried times beneath.
  expect(screen.getByRole("heading", { name: "Owned Editor" })).toBeTruthy();
  expect(screen.getByText("01:11:34 AM–01:12:49 AM")).toBeTruthy();
  expect(lastCall(invoke, "screen_context_list_activity_evidence")).toMatchObject({ recordIds: ["1"], windows: [[start, end]] });
});
it("names the queried local contributors of a mixed Week card instead of only its dominant app",async()=>{
  const {client,invoke}=fixture();const anchor=document.createElement("button");anchor.dataset.evidenceTestAnchor="true";document.body.append(anchor);
  const start=Date.parse("2026-10-21T20:19:05Z"),end=Date.parse("2026-10-21T20:27:47Z");
  const rows:ActivitySegment[]=[
    {id:"1",appName:"drifty",startedAt:"2026-10-21T20:19:05Z",endedAt:"2026-10-21T20:22:05Z",durationSeconds:180,source:"accessibility",platform:"macos"},
    {id:"2",appName:"TextEdit",startedAt:"2026-10-21T20:22:05Z",endedAt:"2026-10-21T20:23:05Z",durationSeconds:60,source:"accessibility",platform:"macos"},
    {id:"3",appName:"drifty",startedAt:"2026-10-21T20:23:05Z",endedAt:"2026-10-21T20:27:47Z",durationSeconds:282,source:"accessibility",platform:"macos"},
    {id:"4",appName:"Unselected remote app",startedAt:"2026-10-21T20:19:05Z",endedAt:"2026-10-21T20:27:47Z",durationSeconds:522,source:"accessibility",platform:"windows",deviceId:"remote"},
  ];
  const queried={recordIds:["1","2","3"],windows:[[start,end] as const]};
  const event:ActivityInspectorEvent={id:"mixed-week",surface:"week",segmentIds:["1","2","3"],appName:"drifty",category:"workspace",productivity:"neutral",startLabel:"8:19 PM",endLabel:"8:28 PM",identities:[],hasMixedCategory:false,hasMixedProductivity:false,screenEvidenceSelection:queried};
  render(<LocalizationTestProvider language="en"><ScreenEvidenceContext.Provider value={client}><WeekActivityInspector event={event} segments={rows.slice(0,3)} screenEvidenceSegments={rows} appIcons={{}} anchorElement={anchor} onClose={()=>{}}/></ScreenEvidenceContext.Provider></LocalizationTestProvider>);
  fireEvent.click(await screen.findByRole("button",{name:PREVIEW}));await screen.findByText("OWNED_FIRST_TEXT");
  const time=(ms:number)=>new Date(ms).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  expect(screen.getByRole("heading",{name:"drifty + TextEdit"})).toBeTruthy();
  expect(screen.getByText(`${time(start)}–${time(end)}`)).toBeTruthy();
  expect(lastCall(invoke,"screen_context_list_activity_evidence")).toMatchObject(queried);
  expect(screen.queryByText(/Unselected remote app/)).toBeNull();
});
it("empty activity evidence stays a read-only empty state",async()=>{
  const {client,invoke}=fixture("empty");
  render(<LocalizationTestProvider language="en"><ActivityScreenEvidenceModal client={client} selection={selection} activityLabel="Owned activity" onClose={()=>{}} onInvalidated={()=>{}}/></LocalizationTestProvider>);
  await screen.findByText("No saved screens are left for this activity.");
  await waitFor(()=>expect(invoke.mock.calls.some(([name])=>name==="screen_context_list_activity_evidence")).toBe(true));
  expect(invoke.mock.calls.some(([name])=>name==="screen_context_read_evidence")).toBe(false);
});

it("selects a displayed contributor for evidence, retains that choice after return, and keeps activity edits on the winner", async () => {
  const { client, invoke } = fixture();
  const anchor = document.createElement("button"); anchor.dataset.evidenceTestAnchor = "true"; document.body.append(anchor);
  const runnerUp = { recordIds: ["2"], windows: [[1200, 1400] as const] };
  const event: ActivityInspectorEvent = { id: "mixed-day", surface: "flow", segmentIds: ["1"], appName: "drifty", category: "workspace", productivity: "focus", startLabel: "10:00", endLabel: "10:15", identities: [], hasMixedCategory: false, hasMixedProductivity: false, screenEvidenceSelection: selection,
    screenEvidenceOptions: [{ id: "winner", label: "drifty", selection }, { id: "runner-up", label: "TextEdit", selection: runnerUp }] };
  const removeActivity = vi.fn();
  render(<LocalizationTestProvider language="en"><ScreenEvidenceContext.Provider value={client}><ActivityInspectionProvider options={{ presentation: "popover", hover: "off" }} scopeKey="mixed-day" onRequestOpen={() => {}}><WeekActivityInspector event={event} segments={[{ id: "1", appName: "drifty", startedAt: "2026-10-20T10:00:00Z", endedAt: "2026-10-20T10:15:00Z", durationSeconds: 900, source: "accessibility", platform: "macos" }]} appIcons={{}} anchorElement={anchor} onDelete={removeActivity} onClose={() => {}} /></ActivityInspectionProvider></ScreenEvidenceContext.Provider></LocalizationTestProvider>);
  fireEvent.change(screen.getByRole("combobox", { name: "Show screens for" }), { target: { value: "runner-up" } });
  await waitFor(() => expect(lastCall(invoke, "screen_context_list_activity_evidence")).toMatchObject(runnerUp));
  fireEvent.click(await screen.findByRole("button", { name: PREVIEW }));
  await screen.findByText("OWNED_FIRST_TEXT");
  expect(screen.getByRole("heading", { name: "TextEdit" })).toBeTruthy();
  expect(screen.getByText("10:00–10:15")).toBeTruthy();
  expect(lastCall(invoke, "screen_context_list_activity_evidence")).toMatchObject(runnerUp);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect((await screen.findByRole<HTMLSelectElement>("combobox", { name: "Show screens for" })).value).toBe("runner-up");
  expect(removeActivity).not.toHaveBeenCalled();
  expect(invoke.mock.calls.some(([name]) => name === "delete_activity_segments" || name === "screen_context_configure")).toBe(false);
});

it("confirms one screen deletion in the same modal, preserves activity and reloads remaining records",async()=>{
  const {client,invoke}=fixture();const invalidated=vi.fn();
  render(<LocalizationTestProvider language="en"><ActivityScreenEvidenceModal client={client} selection={selection} activityLabel="Owned activity · 15 minutes" onClose={()=>{}} onInvalidated={invalidated}/></LocalizationTestProvider>);
  await screen.findByText("OWNED_FIRST_TEXT");
  fireEvent.click(screen.getByRole("button",{name:"Delete this screen…"}));
  // The confirmation stays inside the viewer, beside the screen it deletes.
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole("group",{name:"Delete this screen?"})).toBeTruthy();
  expect(invoke.mock.calls.some(([name])=>name==="screen_context_delete_evidence")).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Delete"}));
  await screen.findByText("OWNED_SECOND_TEXT");
  // One screen's deletion keeps recording running.
  expect(screen.getByText("Deleted.")).toBeTruthy();
  expect(screen.getByRole("heading",{name:"Owned activity"})).toBeTruthy();
  expect(screen.getByText("15 minutes")).toBeTruthy();
  expect(invoke.mock.calls.find(([name])=>name==="screen_context_delete_evidence")?.[1]).toMatchObject({recordId:FIRST,startMs:null,endMs:null});
  expect(invalidated).not.toHaveBeenCalled();
  expect(invoke.mock.calls.some(([name])=>name==="delete_activity_segments"||name==="screen_context_configure")).toBe(false);
});

it("binds the panel log's full selected stretch without widening the activity mutation target",async()=>{
  const {client,invoke}=fixture();const anchor=document.createElement("button");anchor.dataset.evidenceTestAnchor="true";document.body.append(anchor);
  const firstStart=Date.parse("2026-10-20T10:00:00Z"),firstEnd=Date.parse("2026-10-20T10:03:00Z");
  const rows: ActivitySegment[]=[
    {id:"1",startedAt:"2026-10-20T10:00:00Z",endedAt:"2026-10-20T10:03:00Z",durationSeconds:180,appName:"Owned Editor",source:"accessibility",platform:"macos"},
    {id:"2",startedAt:"2026-10-20T10:15:00Z",endedAt:"2026-10-20T10:30:00Z",durationSeconds:900,appName:"Owned Docs",source:"accessibility",platform:"macos"},
    {id:"3",startedAt:"2026-10-20T10:03:00Z",endedAt:"2026-10-20T10:15:00Z",durationSeconds:720,appName:"Unselected app",source:"accessibility",platform:"macos"},
    {id:"4",startedAt:"2026-10-20T10:00:00Z",endedAt:"2026-10-20T10:30:00Z",durationSeconds:1800,appName:"Remote app",source:"accessibility",platform:"windows",deviceId:"remote"},
  ];
  const event:ActivityInspectorEvent={id:"cell-source",surface:"flow",segmentIds:["1"],appName:"Owned Editor",category:"workspace",productivity:"focus",startLabel:"10:00",endLabel:"10:03",identities:[],hasMixedCategory:false,hasMixedProductivity:false,screenEvidenceSelection:{recordIds:["1"],windows:[[firstStart,firstEnd]]},screenEvidenceOptions:[{id:"other-contributor",label:"Unselected app",selection:{recordIds:["3"],windows:[[firstEnd,Date.parse(rows[2].endedAt!)]]}}]};
  const stretch={startMs:Date.parse("2026-10-20T10:01:00Z"),endMs:Date.parse("2026-10-20T10:25:00Z"),segmentIds:["1","2","4"]};
  const removeActivity=vi.fn();
  render(<LocalizationTestProvider language="en"><ScreenEvidenceContext.Provider value={client}><ActivityInspectionProvider options={{presentation:"panel",hover:"off"}} scopeKey="drawn-card" onRequestOpen={()=>{}}><InspectionPanel/><WeekActivityInspector event={event} segments={[rows[0]]} screenEvidenceSegments={rows} detailLog={()=>({runs:[],recordedSeconds:1080})} logStretch={stretch} appIcons={{}} anchorElement={anchor} onDelete={removeActivity} onClose={()=>{}}/></ActivityInspectionProvider></ScreenEvidenceContext.Provider></LocalizationTestProvider>);
  fireEvent.click(await screen.findByRole("button",{name:PREVIEW}));await screen.findByText("OWNED_FIRST_TEXT");
  expect(lastCall(invoke,"screen_context_list_activity_evidence")).toMatchObject({recordIds:["1","2"],windows:[[stretch.startMs,firstEnd],[Date.parse(rows[1].startedAt),stretch.endMs]]});
  fireEvent.click(screen.getByRole("button",{name:"Close"}));
  expect(removeActivity).not.toHaveBeenCalled();
  expect(invoke.mock.calls.some(([name])=>name==="delete_activity_segments"||name==="screen_context_configure")).toBe(false);
});
