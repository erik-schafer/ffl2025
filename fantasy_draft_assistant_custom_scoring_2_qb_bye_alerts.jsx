import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Slider } from "@/components/ui/slider";
import { Trash2, Download, Upload, Search, AlertTriangle, Filter, CheckCircle2, UserPlus, RefreshCw, Sparkles, PlusCircle, XCircle, Settings2 } from "lucide-react";
import Fuse from "fuse.js";
import Papa from "papaparse";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

/**
 * Fantasy Draft Assistant — Single-file React app
 *
 * Features
 * - CSV import (name,pos,team,bye,value,adp,injury?)
 * - Fast fuzzy search (Fuse.js), keyboard nav (↑/↓/Enter)
 * - Claim (your pick) vs Drafted (someone else) status tracking
 * - Filter/Sort, gray or hide drafted
 * - Roster config (supports 2QB etc), bye-week stacking alerts
 * - Pool value by position + scarcity-aware recommendations
 * - LocalStorage persistence, export/import snapshot JSON
 * - Add custom player on the fly
 *
 * Notes
 * - All UI: shadcn/ui + Tailwind. Charts: recharts.
 */

const SAMPLE_CSV = `name,pos,team,bye,value,adp,injury
Josh Allen,QB,BUF,13,98,4,
Jalen Hurts,QB,PHI,10,95,5,
Patrick Mahomes,QB,KC,6,94,8,
Christian McCaffrey,RB,SF,9,100,1,
Breece Hall,RB,NYJ,12,88,9,
Bijan Robinson,RB,ATL,12,86,11,
CeeDee Lamb,WR,DAL,7,94,2,
Justin Jefferson,WR,MIN,6,92,3,
Ja'Marr Chase,WR,CIN,12,90,6,
Travis Kelce,TE,KC,6,80,22,
Sam LaPorta,TE,DET,5,78,26,
Amon-Ra St. Brown,WR,DET,5,89,7,
Garrett Wilson,WR,NYJ,12,82,14,
A.J. Brown,WR,PHI,10,84,10,
Jahmyr Gibbs,RB,DET,5,80,17,
Aidan O'Connell,QB,LV,13,55,160,
Jayden Daniels,QB,WAS,14,68,72,
Dolphins DST,DST,MIA,6,12,140,
49ers DST,DST,SF,9,15,135,
Evan McPherson,K,CIN,12,8,180,`;

const DEFAULT_ROSTER = {
  QB: 2,
  RB: 2,
  WR: 3,
  TE: 1,
  FLEX: 2, // RB/WR/TE
  DST: 1,
  K: 1,
  BENCH: 6,
};

const POS_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "DST", "K"]; // Display order
const FLEX_ELIGIBLE = new Set(["RB", "WR", "TE"]);

const STORAGE_KEY = "fantasy-draft-assistant-v1";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function csvToPlayers(csvText) {
  const { data } = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
  return data.map((r, idx) => ({
    id: `${r.name}-${r.team}-${idx}`,
    name: (r.name || "").trim(),
    pos: (r.pos || "").trim().toUpperCase(),
    team: (r.team || "").trim().toUpperCase(),
    bye: Number(r.bye) || null,
    value: Number(r.value) || 0,
    adp: (r.adp !== undefined && r.adp !== "") ? Number(r.adp) : null,
    injury: (r.injury || "").trim(),
    status: "available", // available | drafted | claimed
  }));
}

function exportJSON(obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `draft-session-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      cb(obj);
    } catch (e) {
      alert("Invalid JSON file");
    }
  };
  reader.readAsText(file);
}

function posCounts(roster, players) {
  const claimed = players.filter(p => p.status === "claimed");
  const counts = { QB:0, RB:0, WR:0, TE:0, FLEX:0, DST:0, K:0 };
  // Fill fixed slots first
  for (const p of claimed) {
    if (counts[p.pos] !== undefined && counts[p.pos] < roster[p.pos]) counts[p.pos]++;
  }
  // Then fill FLEX
  let flexUsed = 0;
  for (const p of claimed) {
    if (FLEX_ELIGIBLE.has(p.pos)) {
      const stillStarter = counts[p.pos] <= roster[p.pos];
      // Eligible to count to FLEX only if not already consuming beyond fixed need
      // Rough heuristic: if we've already filled fixed slots, allocate extra to FLEX until cap
      if (!stillStarter && flexUsed < roster.FLEX) {
        flexUsed++;
      }
    }
  }
  counts.FLEX = flexUsed;
  return counts;
}

function availableByPos(players) {
  const m = { QB:0, RB:0, WR:0, TE:0, FLEX:0, DST:0, K:0 };
  for (const p of players) if (p.status === "available") m[p.pos]++;
  return m;
}

function poolValueByPos(players) {
  const m = { QB:0, RB:0, WR:0, TE:0, FLEX:0, DST:0, K:0 };
  for (const p of players) if (p.status === "available") m[p.pos]+= (p.value||0);
  return POS_ORDER.map(pos => ({ pos, value: m[pos] }));
}

function needsVector(roster, players) {
  // Remaining starters needed per position (excluding bench). FLEX treated later.
  const countsNow = posCounts(roster, players);
  const out = {};
  for (const pos of POS_ORDER) {
    if (pos === "FLEX") continue;
    out[pos] = Math.max(0, (roster[pos] || 0) - (countsNow[pos] || 0));
  }
  // FLEX needs = remaining flex slots after fixed positions filled by flex-eligible overflow
  const totalFlex = roster.FLEX || 0;
  const flexFilled = countsNow.FLEX || 0;
  out.FLEX = Math.max(0, totalFlex - flexFilled);
  return out;
}

function scarcityScore(p, players, roster, scarcityAlpha=30) {
  // Higher score when position is scarce and still needed for starters
  const avail = availableByPos(players);
  const need = needsVector(roster, players);
  const needWeight = (p.pos in need ? (need[p.pos] > 0 ? 1.0 : 0.4) : 0.4);
  const scarcity = 1 / (1 + (avail[p.pos] || 0)); // 0..1-ish
  const flexBoost = (FLEX_ELIGIBLE.has(p.pos) && need.FLEX>0) ? 0.5 : 0;
  return (p.value || 0) + scarcityAlpha * needWeight * (scarcity + flexBoost*0.1);
}

function byeWeekConflicts(players) {
  const claimed = players.filter(p=>p.status==="claimed");
  const byPos = {};
  for (const p of claimed) {
    if (!p.bye) continue;
    byPos[p.pos] = byPos[p.pos] || {};
    byPos[p.pos][p.bye] = (byPos[p.pos][p.bye]||0)+1;
  }
  // return list of {pos, bye, count}
  const conflicts = [];
  for (const pos of Object.keys(byPos)) {
    for (const bye of Object.keys(byPos[pos])) {
      const c = byPos[pos][bye];
      if (c >= 2) conflicts.push({ pos, bye: Number(bye), count: c });
    }
  }
  return conflicts.sort((a,b)=> a.bye-b.bye || a.pos.localeCompare(b.pos));
}

function useFuse(players, keys=["name","team","pos"]) {
  const fuse = useMemo(()=> new Fuse(players, {
    keys,
    threshold: 0.3,
    ignoreLocation: true,
    minMatchCharLength: 2,
  }), [players]);
  return fuse;
}

function PlayerRow({ p, onToggleDrafted, onClaim, showBye, condensed=false }) {
  const statusStyles = p.status === "drafted" ? "opacity-40" : p.status === "claimed" ? "ring-2 ring-green-500" : "";
  return (
    <TableRow className={`${statusStyles}`}>
      <TableCell className="w-[28px]">
        <Checkbox checked={p.status!=="available"} onCheckedChange={() => onToggleDrafted(p)} />
      </TableCell>
      <TableCell className="font-medium whitespace-nowrap">{p.name}</TableCell>
      <TableCell className="whitespace-nowrap"><Badge variant="secondary">{p.pos}</Badge></TableCell>
      <TableCell className="whitespace-nowrap">{p.team}</TableCell>
      <TableCell className="text-right">{p.value?.toFixed?.(0) ?? "-"}</TableCell>
      <TableCell className="text-right">{p.adp ?? "-"}</TableCell>
      {showBye && <TableCell className="text-right">{p.bye ?? "-"}</TableCell>}
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {p.injury && <Badge variant="destructive">{p.injury}</Badge>}
          {p.status!=="claimed" ? (
            <Button size="xs" onClick={()=>onClaim(p)} className="h-7 px-2">
              <UserPlus className="h-4 w-4 mr-1"/> Claim
            </Button>
          ) : (
            <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3"/>Mine</Badge>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function RosterEditor({ roster, setRoster }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4"/>Roster Settings</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {POS_ORDER.filter(p=>p!=="FLEX").map(pos => (
          <div key={pos} className="flex items-center gap-2">
            <Label className="w-10">{pos}</Label>
            <Input type="number" min={0} value={roster[pos] ?? 0} onChange={e=>setRoster(r=>({...r,[pos]:Number(e.target.value)}))} />
          </div>
        ))}
        <div className="col-span-2 flex items-center gap-2">
          <Label className="w-10">FLEX</Label>
          <Input type="number" min={0} value={roster.FLEX ?? 0} onChange={e=>setRoster(r=>({...r,FLEX:Number(e.target.value)}))} />
          <div className="text-xs text-muted-foreground">(RB/WR/TE)</div>
        </div>
        <div className="col-span-2 text-xs text-muted-foreground">Bench is informational only (not used for recs).</div>
        <div className="col-span-2 flex items-center gap-2">
          <Label className="w-14">BENCH</Label>
          <Input type="number" min={0} value={roster.BENCH ?? 0} onChange={e=>setRoster(r=>({...r,BENCH:Number(e.target.value)}))} />
        </div>
      </CardContent>
    </Card>
  );
}

function AddPlayer({ onAdd }) {
  const [form, setForm] = useState({ name:"", pos:"WR", team:"FA", bye:"", value:"", adp:"" });
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><PlusCircle className="h-4 w-4"/>Add Player</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-6 gap-2">
        <Input placeholder="Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="col-span-3"/>
        <Select value={form.pos} onValueChange={(v)=>setForm({...form,pos:v})}>
          <SelectTrigger><SelectValue/></SelectTrigger>
          <SelectContent>
            {POS_ORDER.filter(p=>p!=="FLEX").map(p=> <SelectItem value={p} key={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Team" value={form.team} onChange={e=>setForm({...form,team:e.target.value.toUpperCase()})}/>
        <Input placeholder="Bye" value={form.bye} onChange={e=>setForm({...form,bye:e.target.value})}/>
        <Input placeholder="Value" value={form.value} onChange={e=>setForm({...form,value:e.target.value})}/>
        <Input placeholder="ADP" value={form.adp} onChange={e=>setForm({...form,adp:e.target.value})}/>
        <div className="col-span-6 flex justify-end">
          <Button onClick={()=>{
            if (!form.name) return;
            onAdd({
              id: `${form.name}-${form.team}-${Math.random().toString(36).slice(2,7)}`,
              name: form.name,
              pos: form.pos,
              team: form.team,
              bye: form.bye ? Number(form.bye) : null,
              value: form.value? Number(form.value): 0,
              adp: form.adp? Number(form.adp): null,
              injury: "",
              status: "available",
            });
            setForm({ name:"", pos:"WR", team:"FA", bye:"", value:"", adp:"" });
          }}>Add</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DraftAssistantApp() {
  const persisted = loadState();
  const [players, setPlayers] = useState(persisted?.players || csvToPlayers(SAMPLE_CSV));
  const [roster, setRoster] = useState(persisted?.roster || DEFAULT_ROSTER);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(persisted?.sortKey || "value");
  const [sortDir, setSortDir] = useState(persisted?.sortDir || "desc");
  const [hideDrafted, setHideDrafted] = useState(persisted?.hideDrafted ?? true);
  const [showBye, setShowBye] = useState(persisted?.showBye ?? true);
  const [scarcityAlpha, setScarcityAlpha] = useState(persisted?.scarcityAlpha ?? 30);
  const [tab, setTab] = useState("board");
  const fileInputRef = useRef(null);
  const jsonInputRef = useRef(null);

  useEffect(()=>{
    saveState({ players, roster, sortKey, sortDir, hideDrafted, showBye, scarcityAlpha });
  }, [players, roster, sortKey, sortDir, hideDrafted, showBye, scarcityAlpha]);

  const fuse = useFuse(players);

  const filtered = useMemo(()=>{
    let list = players;
    if (query.trim().length>=2) {
      list = fuse.search(query).map(r=>r.item);
    }
    if (hideDrafted) list = list.filter(p=>p.status!=="drafted");
    list = [...list].sort((a,b)=>{
      const av = a[sortKey] ?? -Infinity; const bv = b[sortKey] ?? -Infinity;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [players, fuse, query, hideDrafted, sortKey, sortDir]);

  const recommendedGreedy = useMemo(()=> filtered.find(p=>p.status==="available"), [filtered]);
  const recommendedBalanced = useMemo(()=>{
    const avail = filtered.filter(p=>p.status==="available");
    let best = null; let bestScore = -Infinity;
    for (const p of avail) {
      const sc = scarcityScore(p, players, roster, scarcityAlpha);
      if (sc>bestScore) { best=p; bestScore=sc; }
    }
    return best;
  }, [filtered, players, roster, scarcityAlpha]);

  const conflicts = useMemo(()=> byeWeekConflicts(players), [players]);
  const poolChart = useMemo(()=> poolValueByPos(players), [players]);

  function setStatus(p, status) {
    setPlayers(ps => ps.map(x => x.id===p.id ? { ...x, status } : x));
  }

  function toggleDrafted(p) {
    if (p.status === "available") setStatus(p, "drafted");
    else if (p.status === "drafted") setStatus(p, "available");
    else if (p.status === "claimed") setStatus(p, "available");
  }

  function claim(p) {
    setStatus(p, "claimed");
  }

  function clearAllStatuses() {
    if (!confirm("Clear all claimed/drafted marks?")) return;
    setPlayers(ps => ps.map(p=> ({...p, status:"available"})) );
  }

  function removeDrafted() {
    setPlayers(ps => ps.filter(p=>p.status!=="drafted"));
  }

  function onCSVFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const list = csvToPlayers(reader.result);
        setPlayers(list);
      } catch (e) {
        alert("Failed to parse CSV");
      }
    };
    reader.readAsText(file);
  }

  function addPlayer(p) {
    setPlayers(ps => [p, ...ps]);
  }

  function exportSnapshot() {
    exportJSON({ players, roster, sortKey, sortDir, hideDrafted, showBye, scarcityAlpha, version: 1 });
  }

  function importSnapshot(file) {
    importJSON(file, (obj)=>{
      if (!obj || !obj.players) return alert("Invalid snapshot");
      setPlayers(obj.players);
      if (obj.roster) setRoster(obj.roster);
      if (obj.sortKey) setSortKey(obj.sortKey);
      if (obj.sortDir) setSortDir(obj.sortDir);
      if (typeof obj.hideDrafted === "boolean") setHideDrafted(obj.hideDrafted);
      if (typeof obj.showBye === "boolean") setShowBye(obj.showBye);
      if (typeof obj.scarcityAlpha === "number") setScarcityAlpha(obj.scarcityAlpha);
    });
  }

  const myRoster = players.filter(p=>p.status==="claimed");

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Fantasy Draft Assistant</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={()=>fileInputRef.current?.click()} className="gap-2"><Upload className="h-4 w-4"/> Import CSV</Button>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={e=> e.target.files?.[0] && onCSVFile(e.target.files[0])}/>
          <Button variant="outline" onClick={()=>jsonInputRef.current?.click()} className="gap-2"><Upload className="h-4 w-4"/> Import Snapshot</Button>
          <input ref={jsonInputRef} type="file" accept=".json" className="hidden" onChange={e=> e.target.files?.[0] && importSnapshot(e.target.files[0])}/>
          <Button variant="secondary" onClick={exportSnapshot} className="gap-2"><Download className="h-4 w-4"/> Export</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left rail */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Quick Controls</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"/>
                  <Input placeholder="Search name, team, pos… (min 2 chars)" value={query} onChange={e=>setQuery(e.target.value)} className="pl-8"/>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="icon"><Filter className="h-4 w-4"/></Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Checkbox id="hideDrafted" checked={hideDrafted} onCheckedChange={v=>setHideDrafted(!!v)} />
                        <Label htmlFor="hideDrafted">Hide drafted</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox id="showBye" checked={showBye} onCheckedChange={v=>setShowBye(!!v)} />
                        <Label htmlFor="showBye">Show bye week</Label>
                      </div>
                      <div className="space-y-1">
                        <Label>Sort</Label>
                        <div className="flex gap-2">
                          <Select value={sortKey} onValueChange={setSortKey}>
                            <SelectTrigger className="w-28"><SelectValue/></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="value">Value</SelectItem>
                              <SelectItem value="adp">ADP</SelectItem>
                              <SelectItem value="name">Name</SelectItem>
                              <SelectItem value="pos">Pos</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={sortDir} onValueChange={setSortDir}>
                            <SelectTrigger className="w-28"><SelectValue/></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="desc">Desc</SelectItem>
                              <SelectItem value="asc">Asc</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label>Scarcity weight</Label>
                        <Slider min={0} max={60} step={2} value={[scarcityAlpha]} onValueChange={([v])=>setScarcityAlpha(v)} />
                        <div className="text-xs text-muted-foreground">Higher increases position-scarcity emphasis in balanced rec.</div>
                      </div>
                      <div className="flex gap-2 justify-between pt-1">
                        <Button variant="outline" size="sm" onClick={removeDrafted} className="gap-1"><XCircle className="h-4 w-4"/>Remove drafted</Button>
                        <Button variant="outline" size="sm" onClick={clearAllStatuses} className="gap-1"><RefreshCw className="h-4 w-4"/>Reset</Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="text-xs text-muted-foreground">Tip: click the checkbox to mark drafted (any team). Use "Claim" to mark as your pick.</div>
            </CardContent>
          </Card>

          <RosterEditor roster={roster} setRoster={setRoster} />
          <AddPlayer onAdd={addPlayer} />

          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Bye Week Alerts</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {conflicts.length===0 ? (
                <div className="text-sm text-muted-foreground">No conflicts detected.</div>
              ) : (
                <div className="space-y-1">
                  {conflicts.map((c, i)=> (
                    <div key={i} className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-yellow-600"/> {c.pos} has {c.count} starters on bye in week {c.bye}</div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Center: Board */}
        <div className="lg:col-span-6 space-y-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="board">Board</TabsTrigger>
              <TabsTrigger value="mine">My Roster</TabsTrigger>
            </TabsList>
            <TabsContent value="board">
              <Card>
                <CardHeader className="pb-0"><CardTitle className="text-base">Players</CardTitle></CardHeader>
                <CardContent>
                  <ScrollArea className="h-[560px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[28px]">Pick?</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Pos</TableHead>
                          <TableHead>Team</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                          <TableHead className="text-right">ADP</TableHead>
                          {showBye && <TableHead className="text-right">Bye</TableHead>}
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map(p => (
                          <PlayerRow key={p.id} p={p} onToggleDrafted={toggleDrafted} onClaim={claim} showBye={showBye} />
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="mine">
              <Card>
                <CardHeader className="pb-0"><CardTitle className="text-base">Your Picks</CardTitle></CardHeader>
                <CardContent>
                  {myRoster.length===0 ? (
                    <div className="text-sm text-muted-foreground">No players claimed yet.</div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {myRoster.map(p => (
                        <Card key={p.id} className="border-green-500">
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{p.name}</div>
                              <Badge variant="outline">{p.pos}</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">{p.team} • {p.bye ? `Bye ${p.bye}` : ""}</div>
                            <div className="flex gap-2 justify-end pt-2">
                              <Button size="xs" variant="outline" onClick={()=>setStatus(p, "available")} className="h-7 px-2">Unclaim</Button>
                              <Button size="xs" variant="outline" onClick={()=>setStatus(p, "drafted")} className="h-7 px-2">Mark Drafted</Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right rail */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4"/>Recommendations</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Greedy (highest value)</div>
                {recommendedGreedy ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{recommendedGreedy.name}</div>
                      <div className="text-xs text-muted-foreground">{recommendedGreedy.pos} • {recommendedGreedy.team} • {recommendedGreedy.bye?`Bye ${recommendedGreedy.bye}`:""}</div>
                    </div>
                    <Button size="sm" onClick={()=>claim(recommendedGreedy)}>Claim</Button>
                  </div>
                ) : <div className="text-sm text-muted-foreground">No available players.</div>}
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Balanced (value + scarcity)</div>
                {recommendedBalanced ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{recommendedBalanced.name}</div>
                      <div className="text-xs text-muted-foreground">{recommendedBalanced.pos} • {recommendedBalanced.team} • {recommendedBalanced.bye?`Bye ${recommendedBalanced.bye}`:""}</div>
                    </div>
                    <Button size="sm" onClick={()=>claim(recommendedBalanced)}>Claim</Button>
                  </div>
                ) : <div className="text-sm text-muted-foreground">No available players.</div>}
              </div>
              <div className="text-xs text-muted-foreground">Tune the scarcity slider in Filters to emphasize position scarcity (e.g., RB runs).</div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Pool Value by Position</CardTitle></CardHeader>
            <CardContent>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={poolChart}>
                    <XAxis dataKey="pos" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Session</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={()=>fileInputRef.current?.click()} className="gap-1"><Upload className="h-4 w-4"/>CSV</Button>
                <Button variant="outline" size="sm" onClick={()=>jsonInputRef.current?.click()} className="gap-1"><Upload className="h-4 w-4"/>Import</Button>
                <Button size="sm" onClick={exportSnapshot} className="gap-1"><Download className="h-4 w-4"/>Export</Button>
              </div>
              <div className="text-xs text-muted-foreground">CSV columns expected: name,pos,team,bye,value,adp,injury</div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">How to use</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <ol className="list-decimal list-inside space-y-1">
            <li>Import your CSV of players (include your custom <b>value</b> metric and ADP).</li>
            <li>Set roster to match your league (supports 2QB, extra FLEX, etc.).</li>
            <li>During the draft: use the checkbox to mark <i>drafted</i> for any team; click <i>Claim</i> for your picks.</li>
            <li>Watch <i>Recommendations</i> (Greedy vs Balanced) and <i>Pool Value by Position</i> to time position runs.</li>
            <li>Use <i>Bye Week Alerts</i> to avoid stacking key starters off the same week.</li>
            <li>Export a snapshot anytime to resume later.</li>
          </ol>
        </CardContent>
      </Card>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Schema details</summary>
        <div className="mt-2">
          CSV headers: <code>name,pos,team,bye,value,adp,injury</code>. <b>pos</b> one of QB,RB,WR,TE,DST,K. <b>value</b> is your composite score (higher=better). ADP optional.
        </div>
      </details>
    </div>
  );
}
