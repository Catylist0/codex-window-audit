(() => {
  "use strict";
  const report = window.REPORT;
  if (!report || !Array.isArray(report.records)) {
    document.querySelector("main").textContent = "The aggregate window data could not be loaded.";
    return;
  }

  const modelNames = {"gpt-5.5":"GPT-5.5","gpt-5.6-sol":"Sol","gpt-5.6-luna":"Luna","gpt-6-astra":"Astra","codex-auto-review":"Auto review"};
  const colors = {"gpt-5.5":"#f4be63","gpt-5.6-sol":"#74b9d2","gpt-6-astra":"#f08675","gpt-5.6-luna":"#acd59f","codex-auto-review":"#9c98b8"};
  const records = report.records.map((row, index) => {
    const dominant = Object.entries(row.modelTokens).sort((a,b) => b[1]-a[1])[0]?.[0] || "unknown";
    return {...row, index, dominant, timestamp: Date.parse(row.lastReadingAt), priceComplete: row.unpricedModels.length === 0};
  });
  const money = value => "$" + Number(value).toFixed(2);
  const moneyApprox = value => "$" + Number(value).toFixed(1);
  const tokenCount = value => new Intl.NumberFormat("en-US", {notation:"compact",maximumFractionDigits:2}).format(value);
  const median = values => { const sorted = values.slice().sort((a,b)=>a-b); return sorted.length ? (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.floor(sorted.length/2)])/2 : NaN; };
  const dayLabel = row => row.date.slice(5).replace("-", "/") + " " + row.time;
  const mix = row => Object.entries(row.modelTokens).sort((a,b)=>b[1]-a[1]).map(([name,tokens]) => ({name, tokens, percent: 100*tokens/row.totalTokens}));
  const category = row => row.observedFull ? "Observed" : "Extrapolated";
  const quality = row => row.priceQuality === "partial" ? "Partial price" : row.priceQuality === "historical-inferred" ? "Historical inference" : "Dated ledger";

  const headline = document.getElementById("headline-stats");
  [[records.length,"windows ≥80%"],[records.filter(r=>r.observedFull).length,"observed 100%"],[new Set(records.map(r=>r.date)).size,"calendar days"]].forEach(([number,label]) => {
    const wrap=document.createElement("div"),strong=document.createElement("strong"),span=document.createElement("span");
    strong.textContent=number;span.textContent=label;wrap.append(strong,span);headline.append(wrap);
  });
  const solBaseline = records.filter(r => r.date >= "2026-08-26" && r.date <= "2026-09-22" && r.dominant === "gpt-5.6-sol" && r.priceComplete && r.minPercent <= 5 && r.maxPercent >= 85);
  const astraBaseline = records.filter(r => r.date >= "2026-09-23" && r.dominant === "gpt-6-astra" && r.priceComplete && r.minPercent <= 5 && r.maxPercent >= 85);
  document.getElementById("sol-median").textContent = moneyApprox(median(solBaseline.map(r=>r.fullWindowUsd)));
  document.getElementById("astra-median").textContent = moneyApprox(median(astraBaseline.map(r=>r.fullWindowUsd)));

  const filters = ["status-filter","peak-filter","model-filter","quality-filter"].map(id => document.getElementById(id));
  function selected() {
    const [status,peak,model,quality] = filters.map(el=>el.value);
    return records.filter(row =>
      (status === "all" || (status === "observed" ? row.observedFull : !row.observedFull)) &&
      row.maxPercent >= Number(peak) &&
      (model === "all" || row.dominant === model) &&
      (quality === "all" || (quality === "complete" ? row.priceComplete : row.priceQuality === "dated-ledger"))
    );
  }

  function makeCell(text, cls) { const cell=document.createElement("td"); if (cls) cell.className=cls; cell.textContent=text; return cell; }
  function renderTable(rows) {
    const body=document.getElementById("records-body"); body.replaceChildren();
    rows.forEach(row=>{
      const tr=document.createElement("tr");
      tr.append(makeCell(`${row.date} · ${row.time}`),makeCell(`${row.maxPercent.toFixed(0)}%`),makeCell(tokenCount(row.totalTokens)),makeCell(tokenCount(row.totalTokens*100/row.maxPercent)),makeCell((row.priceComplete ? "" : "≥")+money(row.recordedUsd)),makeCell((row.priceComplete ? "" : "≥")+money(row.fullWindowUsd)));
      const status=makeCell(""); const pill=document.createElement("span");pill.className="pill "+(row.observedFull?"observed":"extrapolated");pill.textContent=category(row);status.append(pill);tr.append(status);
      const mixCell=document.createElement("td");mixCell.className="mix"; const mixText=document.createElement("span");mixText.className="mix-text";mixText.textContent=mix(row).filter(x=>x.percent>=0.5).map(x=>`${modelNames[x.name]||x.name} ${tokenCount(x.tokens)} (${Math.round(x.percent)}%)`).join(" · ");
      const bar=document.createElement("div");bar.className="mix-bar";bar.setAttribute("aria-hidden","true");mix(row).forEach(x=>{const part=document.createElement("span");part.style.width=x.percent+"%";part.style.background=colors[x.name]||"#888";bar.append(part);});mixCell.append(mixText,bar);tr.append(mixCell);
      const q=makeCell("");if(row.priceQuality==="partial"){const qpill=document.createElement("span");qpill.className="pill partial";qpill.textContent=quality(row);q.append(qpill);}else q.textContent=quality(row);tr.append(q);
      body.append(tr);
    });
  }

  const chartState = new Map();
  function drawChart(canvas, rows, type) {
    const width=canvas.clientWidth,height=canvas.clientHeight,dpr=window.devicePixelRatio||1;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);
    const box={left:58,right:width-20,top:22,bottom:height-43};
    const minX=type==="timeline" ? Math.min(...records.map(r=>r.timestamp)) : 0;
    const maxX=type==="timeline" ? Math.max(...records.map(r=>r.timestamp)) : 35_000_000;
    const minY=0,maxY=type==="timeline" ? 25 : 25;
    const X=x=>box.left+(x-minX)/(maxX-minX)*(box.right-box.left);
    const Y=y=>box.bottom-(y-minY)/(maxY-minY)*(box.bottom-box.top);
    ctx.font="11px system-ui,sans-serif";ctx.textAlign="right";ctx.textBaseline="middle";
    for(let value=0;value<=25;value+=5){const yy=Y(value);ctx.strokeStyle="#394452";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(box.left,yy);ctx.lineTo(box.right,yy);ctx.stroke();ctx.fillStyle="#a6afba";ctx.fillText("$"+value,box.left-11,yy);}
    ctx.textBaseline="top";ctx.textAlign="center";
    if(type==="timeline"){
      ["2026-07-01","2026-08-01","2026-09-01","2026-09-23"].forEach(date=>{const xx=X(Date.parse(date+"T12:00:00Z"));if(xx<box.left||xx>box.right)return;ctx.fillStyle="#a6afba";ctx.fillText(date.slice(5),xx,box.bottom+11);});
      const change=X(Date.parse("2026-09-23T00:00:00Z"));ctx.setLineDash([5,5]);ctx.strokeStyle="#e9968480";ctx.beginPath();ctx.moveTo(change,box.top);ctx.lineTo(change,box.bottom);ctx.stroke();ctx.setLineDash([]);
    } else {
      [0,5,10,15,20,25,30,35].forEach(value=>{const xx=X(value*1_000_000);ctx.fillStyle="#a6afba";ctx.fillText(value+"M",xx,box.bottom+11);});
    }
    const points=[];
    rows.forEach(row=>{
      const xx=X(type==="timeline"?row.timestamp:row.totalTokens*100/row.maxPercent), yy=Y(row.fullWindowUsd);
      const radius=row.observedFull?5:5.5;ctx.beginPath();ctx.arc(xx,yy,radius,0,Math.PI*2);ctx.lineWidth=2;ctx.strokeStyle=colors[row.dominant]||"#ddd";ctx.fillStyle=row.observedFull?(colors[row.dominant]||"#ddd"):"#1c222d";ctx.fill();ctx.stroke();points.push({x:xx,y:yy,row});
    });
    chartState.set(canvas,{points});
  }
  function drawTokenChart(canvas, rows) {
    const width=canvas.clientWidth,height=canvas.clientHeight,dpr=window.devicePixelRatio||1;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);
    const box={left:58,right:width-20,top:22,bottom:height-43};
    const maxTokens=Math.max(5_000_000,Math.ceil(Math.max(...records.map(r=>r.totalTokens*100/r.maxPercent))/5_000_000)*5_000_000);
    const Y=value=>box.bottom-value/maxTokens*(box.bottom-box.top);
    const tick=5_000_000;ctx.font="11px system-ui,sans-serif";ctx.textBaseline="middle";ctx.textAlign="right";
    for(let value=0;value<=maxTokens;value+=tick){const y=Y(value);ctx.strokeStyle="#394452";ctx.beginPath();ctx.moveTo(box.left,y);ctx.lineTo(box.right,y);ctx.stroke();ctx.fillStyle="#a6afba";ctx.fillText(value/1_000_000+"M",box.left-10,y);}
    const slot=(box.right-box.left)/Math.max(1,rows.length),barWidth=Math.max(2,Math.min(22,slot*.68)),points=[];
    rows.forEach((row,index)=>{
      const x=box.left+slot*(index+.5);let used=0;
      Object.entries(row.modelTokens).sort((a,b)=>b[1]-a[1]).forEach(([model,tokens])=>{
        const amount=tokens*100/row.maxPercent;const y1=Y(used+amount),y2=Y(used);
        ctx.globalAlpha=row.observedFull?1:.66;ctx.fillStyle=colors[model]||"#9c98b8";ctx.fillRect(x-barWidth/2,y1,barWidth,Math.max(1,y2-y1));ctx.globalAlpha=1;used+=amount;
      });
      if(!row.observedFull){ctx.strokeStyle="#e9e7db";ctx.lineWidth=1;ctx.setLineDash([3,2]);ctx.strokeRect(x-barWidth/2,Y(used),barWidth,box.bottom-Y(used));ctx.setLineDash([]);}
      if(index===0||index===rows.length-1||index%Math.max(1,Math.ceil(rows.length/6))===0){ctx.textAlign="center";ctx.textBaseline="top";ctx.fillStyle="#a6afba";ctx.fillText(row.date.slice(5),x,box.bottom+11);}
      points.push({x,y:Y(used),row,slot});
    });
    chartState.set(canvas,{points,box});
  }
  function attachTooltip(canvas,tooltip) {
    canvas.addEventListener("mousemove",event=>{
      const rect=canvas.getBoundingClientRect();const x=event.clientX-rect.left,y=event.clientY-rect.top;
      const nearest=(chartState.get(canvas)?.points||[]).map(p=>({...p,d:Math.hypot(p.x-x,p.y-y)})).sort((a,b)=>a.d-b.d)[0];
      if(!nearest||nearest.d>13){tooltip.hidden=true;return;}
      const r=nearest.row;tooltip.textContent=`${r.date} ${r.time} · ${r.maxPercent.toFixed(0)}% used · ${tokenCount(r.totalTokens*100/r.maxPercent)} tokens/100% · ${money(r.fullWindowUsd)} USD/100% · ${modelNames[r.dominant]||r.dominant}${r.observedFull?" · observed":" · extrapolated"}${r.priceComplete?"":" · partial price"}`;
      tooltip.hidden=false;tooltip.style.left=Math.max(8,Math.min(x+16,rect.width-220))+"px";tooltip.style.top=Math.max(10,y-55)+"px";
    });
    canvas.addEventListener("mouseleave",()=>tooltip.hidden=true);
  }
  attachTooltip(document.getElementById("timeline-chart"),document.getElementById("timeline-tooltip"));
  attachTooltip(document.getElementById("scatter-chart"),document.getElementById("scatter-tooltip"));
  document.getElementById("tokens-chart").addEventListener("mousemove",event=>{
    const canvas=event.currentTarget,tooltip=document.getElementById("tokens-tooltip"),state=chartState.get(canvas),rect=canvas.getBoundingClientRect();
    if(!state||!state.points.length){tooltip.hidden=true;return;}
    const x=event.clientX-rect.left,y=event.clientY-rect.top;
    const nearest=state.points.reduce((a,b)=>Math.abs(b.x-x)<Math.abs(a.x-x)?b:a);
    if(Math.abs(nearest.x-x)>Math.max(7,nearest.slot*.48)||y<state.box.top||y>state.box.bottom){tooltip.hidden=true;return;}
    const row=nearest.row,parts=mix(row).map(part=>`${modelNames[part.name]||part.name} ${tokenCount(part.tokens)} (${part.percent.toFixed(1)}%)`).join(" · ");
    tooltip.textContent=`${row.date} ${row.time} · ${row.maxPercent.toFixed(0)}% used · ${tokenCount(row.totalTokens)} recorded · ${tokenCount(row.totalTokens*100/row.maxPercent)} per 100% · ${parts}${row.observedFull?" · observed":" · extrapolated"}`;
    tooltip.hidden=false;tooltip.style.left=Math.max(8,Math.min(x+16,rect.width-220))+"px";tooltip.style.top=Math.max(10,y-70)+"px";
  });
  document.getElementById("tokens-chart").addEventListener("mouseleave",()=>document.getElementById("tokens-tooltip").hidden=true);

  function render(){const rows=selected();document.getElementById("filter-count").textContent=`Showing ${rows.length} of ${records.length} windows`;renderTable(rows);drawChart(document.getElementById("timeline-chart"),rows,"timeline");drawTokenChart(document.getElementById("tokens-chart"),rows);drawChart(document.getElementById("scatter-chart"),rows,"scatter");}
  filters.forEach(el=>el.addEventListener("change",render));
  let resizeTimer;window.addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(render,90);});
  document.getElementById("download-csv").addEventListener("click",()=>{
    const models=["gpt-5.5","gpt-5.6-sol","gpt-5.6-luna","gpt-6-astra","codex-auto-review"];
    const header=["date","time_uk","minimum_usage_percent","max_usage_percent","snapshot_count","recorded_usd","usd_per_100_percent","observed_full","extrapolated","price_quality","total_tokens","tokens_per_100_percent"];
    models.forEach(model=>{const key=model.replaceAll("-","_");header.push(key+"_tokens",key+"_tokens_per_100_percent",key+"_token_share");});
    const csv=[header.join(",")];for(const r of selected()){
      const row=[r.date,r.time,r.minPercent,r.maxPercent,r.snapshotCount,r.recordedUsd,r.fullWindowUsd,r.observedFull,!r.observedFull,r.priceQuality,r.totalTokens,r.totalTokens*100/r.maxPercent];
      models.forEach(model=>{const tokens=r.modelTokens[model]||0;row.push(tokens,tokens*100/r.maxPercent,r.totalTokens?tokens/r.totalTokens:0);});csv.push(row.join(","));
    }
    const blob=new Blob([csv.join("\n")+"\n"],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="codex-five-hour-windows.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  });
  render();
})();
