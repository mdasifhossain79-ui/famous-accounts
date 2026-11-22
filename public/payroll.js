/* Certificate & Payslip module (ported from the Payroll app) */
(function(){
const $=s=>document.querySelector(s);
const tdy=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const api=async(m,u,b)=>{const url='/api/hr/'+(/^(ref|backup)\//.test(u)?u:'t/'+u);
 const r=await fetch(url,{method:m,headers:{'Content-Type':'application/json'},body:b&&JSON.stringify(b)});
 if(r.status==401){if(window.showLogin)showLogin();throw new Error('Locked')}
 const j=await r.json().catch(()=>({}));
 if(!r.ok){j.error=j.error||'Request failed';if(m!='GET'&&!/^ref\//.test(u))alert(j.error);return j}
 return j};
const MON='January February March April May June July August September October November December'.split(' ');
const yr=new Date().getFullYear(),YRS=Array.from({length:11},(_,i)=>yr-9+i);
const fmt=n=>'৳'+Number(n||0).toLocaleString('en-IN'),c0=v=>v===''||v==null||+v==0?'':Number(v).toLocaleString('en-IN');
const dm=s=>{if(!s)return'';const[y,m,d]=s.split('-');return`${d}-${MON[m-1].slice(0,3)}-${y.slice(2)}`};
const A='One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen'.split(' '),B='_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety'.split(' ');
const w2=n=>n<20?A[n-1]||'':B[n/10|0]+(n%10?' '+A[n%10-1]:'');
const words=n=>{n=Math.round(n);if(n<=0)return'Zero Taka';const o=[];for(const[d,l]of[[1e7,'Crore'],[1e5,'Lakh'],[1e3,'Thousand'],[100,'Hundred']])if(n>=d){const q=n/d|0;o.push((q>=100?words(q).replace(' Taka',''):w2(q))+' '+l);n%=d}if(n)o.push(w2(n));return o.join(' ')+' Taka'};
// default salary heads: [name, % of gross] (0 = typed manually). Editable in Settings.
const HD={e:[['Basic',60],['House rent',30],['Medical Allowance',6],['Conveyance',4],['Food Allowance',0],['Education Allowance',0],['Salary Arrear',0]],d:['Group Insurance','House Rent & Others','Welfare Fund','Absent Deduction','Loan Adjustment','Income Tax','Salary Deduction']};
const D={};let cur='overview';
const heads=()=>{try{return JSON.parse(D.company[0].heads)||HD}catch{return HD}};
const S={
 employees:{t:'Employees',cols:['emp_code','name','designation_id','department_id','total'],f:[['emp_code','Employee code'],['name','Full name'],['gender','Gender',['Male','Female']],['designation_id','Designation','@designations'],['department_id','Department','@departments'],['join_date','Date of joining','date'],['job_status','Job status',['Permanent','Probation','Contract']],['bank_name','Bank name'],['account_no','Bank account number'],['nid','NID / Passport'],['nationality','Nationality'],['tin','TIN'],['salary_category','Salary category',['Monthly Salaried','Daily Wage','Piece Rate','Contract']],['payment_mode','Payment mode',['Bank Transfer','Cash','Cheque','Mobile Banking']],['total','Gross salary (monthly)','number']]},
 departments:{t:'Departments',cols:['name'],f:[['name','Department name']]},
 designations:{t:'Designations',cols:['name'],f:[['name','Designation name']]},
 signatories:{t:'Signatories',cols:['name','title'],f:[['name','Name'],['title','Title']]}};
const NAV=[['overview','Overview'],['employees','Employees'],['statements','Salary statements'],['yearly','Yearly certificate'],['cert_history','Certificate history'],['departments','Departments'],['designations','Designations'],['signatories','Signatories'],['backup','Backup'],['settings','Settings']];
const load=async()=>{for(const t of ['company','employees','statements','departments','designations','signatories','cert_history'])D[t]=await api('GET',t);if(D.company[0])PCO=D.company[0]};
const nm=(t,id)=>(D[t].find(x=>x.id==id)||{}).name||'';
const show=(f,v)=>{const t=f[2];if(typeof t=='string'&&t[0]=='@')return nm(t.slice(1),v);if(t=='number')return fmt(v);return v??''};
const lab=(t,o)=>t=='employees'&&o.emp_code?`${o.emp_code} — ${o.name}`:o.name;
const inp=(f,v)=>{const[n,,t='text']=f;
 if(Array.isArray(t))return`<select name="${n}">${t.map(o=>`<option ${o==v?'selected':''}>${o}</option>`).join('')}</select>`;
 if(t[0]=='@'){const T=t.slice(1),o=D[T].find(x=>x.id==v);return`<div class="cb"><input class="cbi" data-t="${T}" autocomplete="off" placeholder="Type ${T=='employees'?'name or ID':'to search'}…" value="${o?lab(T,o):''}"><input type="hidden" name="${n}" value="${v??''}"><div class="cbl" hidden></div></div>`}
 return`<input name="${n}" type="${t}" value="${v??''}">`};
function nav(){$('#hrnav').innerHTML=NAV.map(([k,l])=>`<button type="button" class="${k==cur?'on':''}" data-k="${k}">${l}</button>`).join('');document.querySelectorAll('#hrnav button').forEach(a=>a.onclick=()=>go(a.dataset.k))}
async function go(k){cur=k;await load();nav();$('#hrttl').textContent=NAV.find(n=>n[0]==k)[1];$('#hradd').hidden=!(S[k]||k=='statements');$('#hrpr').hidden=['settings','backup','yearly'].includes(k);const f={overview,settings,backup,statements:slist,yearly:ylist,cert_history:hlist}[k];f?f():list(k)}
function overview(){const m=MON[new Date().getMonth()],pm=D.statements.filter(p=>p.month==m&&p.year==yr);
 $('#hrv').innerHTML=`<div class="kpis"><div class="card kpi"><small>Employees</small><b>${D.employees.length}</b></div><div class="card kpi"><small>Statements this month</small><b>${pm.length}</b></div><div class="card kpi"><small>Total statements</small><b>${D.statements.length}</b></div><div class="card kpi"><small>Net payroll this month</small><b>${fmt(pm.reduce((a,p)=>a+ +p.net,0))}</b></div></div>
 <div class="card"><b>Recent salary statements</b><table><tr><th>Employee</th><th>Period</th><th>Net</th></tr>${D.statements.slice(0,6).map(p=>`<tr><td>${nm('employees',p.employee_id)}</td><td>${p.month} ${p.year}</td><td>${fmt(p.net)}</td></tr>`).join('')||'<tr><td class="empty" colspan=3>No statements yet. Add an employee, then a salary statement.</td></tr>'}</table></div>`}
const opts=t=>D[t].map(o=>`<option value="${o.id}">${o.name}</option>`).join('');
function list(k){const s=S[k],emp=k=='employees';
 $('#hrv').innerHTML=`<div class="card">${emp?`<div class="bar"><input id="q" placeholder="Search name or code"><select id="fd"><option value="">All departments</option>${opts('departments')}</select><select id="fg"><option value="">All designations</option>${opts('designations')}</select><button class="pri" id="imp">Import employees</button></div>`:''}<div id="tb"></div></div>`;
 const draw=()=>{let rows=D[k];if(emp){const q=$('#q').value.toLowerCase();rows=rows.filter(r=>(!q||(r.name+' '+(r.emp_code||'')).toLowerCase().includes(q))&&(!$('#fd').value||r.department_id==$('#fd').value)&&(!$('#fg').value||r.designation_id==$('#fg').value))}
  $('#tb').innerHTML=`<table><tr>${s.cols.map(c=>`<th>${s.f.find(f=>f[0]==c)[1]}</th>`).join('')}<th></th></tr>${rows.map(r=>`<tr>${s.cols.map(c=>`<td>${show(s.f.find(f=>f[0]==c),r[c])}</td>`).join('')}<td style="text-align:right"><button data-e="${r.id}">Edit</button> <button class="del" data-d="${r.id}">Delete</button></td></tr>`).join('')||`<tr><td class="empty" colspan=9>Nothing found. Click Add or change the filter.</td></tr>`}</table>`;bind(k,rows)};
 if(emp){$('#q').oninput=$('#fd').oninput=$('#fg').oninput=draw;$('#imp').onclick=importer}draw()}
function bind(k,rows){document.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>(k=='statements'?sform:r=>form(k,r))(rows.find(r=>r.id==b.dataset.e)));
 document.querySelectorAll('[data-d]').forEach(b=>b.onclick=async()=>{if(confirm('Delete this record?')){await api('DELETE',k+'/'+b.dataset.d);go(k)}});
 document.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>reprint(rows.find(r=>r.id==b.dataset.r)));
 document.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>sdoc(rows.find(r=>r.id==b.dataset.c),'cert'));
 document.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>sdoc(rows.find(r=>r.id==b.dataset.p),'slip'))}
function form(k,r={}){const s=S[k];$('#hm').hidden=false;
 $('#hm').innerHTML=`<div class="box"><h3>${r.id?'Edit':'Add'} · ${s.t}</h3><form>${s.f.map(f=>`<div><label>${f[1]}</label>${inp(f,r[f[0]])}</div>`).join('')}<div class="act"><button type="button" id="x">Cancel</button><button class="pri">Save</button></div></form></div>`;
 $('#x').onclick=()=>$('#hm').hidden=true;
 if(k=='employees'&&!r.id)$('#hm form').elements.emp_code.onchange=ev=>{const x=D.employees.find(e=>e.emp_code&&e.emp_code.toLowerCase()==ev.target.value.trim().toLowerCase());if(x&&confirm(`Employee ID already exists (${x.name}). Load the saved details?`))form(k,x)};
 $('#hm form').onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));await(r.id?api('PUT',`${k}/${r.id}`,b):api('POST',k,b));$('#hm').hidden=true;go(k)}}
function slist(){
 $('#hrv').innerHTML=`<div class="card"><div class="bar"><input id="q" placeholder="Search employee or ref no."><select id="fm"><option value="">All months</option>${MON.map(m=>`<option>${m}</option>`).join('')}</select><select id="fy"><option value="">All years</option>${YRS.map(y=>`<option>${y}</option>`).join('')}</select></div>
 <div class="bar"><button class="pri" id="bk">Bulk generate</button><button id="pc">Print all certificates</button><button id="pp">Print all payslips</button></div><div id="tb"></div></div>`;
 let rows=[];const draw=()=>{const q=$('#q').value.toLowerCase();rows=D.statements.filter(r=>(!q||(nm('employees',r.employee_id)+' '+(r.ref_no||'')).toLowerCase().includes(q))&&(!$('#fm').value||r.month==$('#fm').value)&&(!$('#fy').value||r.year==$('#fy').value));
  $('#tb').innerHTML=`<table><tr><th>Employee</th><th>Period</th><th>Ref no.</th><th>Gross</th><th>Deductions</th><th>Net</th><th></th></tr>${rows.map(r=>`<tr><td>${nm('employees',r.employee_id)}</td><td>${r.month} ${r.year}</td><td>${r.ref_no||''}</td><td>${fmt(r.gross)}</td><td>${fmt(r.deductions)}</td><td>${fmt(r.net)}</td><td style="text-align:right"><button data-c="${r.id}">Certificate</button> <button data-p="${r.id}">Payslip</button> <button data-e="${r.id}">Edit</button> <button class="del" data-d="${r.id}">Delete</button></td></tr>`).join('')||'<tr><td class="empty" colspan=7>No statements found.</td></tr>'}</table>`;bind('statements',rows)};
 $('#q').oninput=$('#fm').oninput=$('#fy').oninput=draw;$('#bk').onclick=bulk;$('#pc').onclick=()=>printAll(rows,'cert');$('#pp').onclick=()=>printAll(rows,'slip');draw()}
function hlist(){$('#hrv').innerHTML=`<div class="card"><p style="margin-top:0;color:var(--mu)">Every certificate or payslip you print is saved here exactly as issued. Reprint any time, even if the salary data changes later.</p><div class="bar"><input id="q" placeholder="Search employee or ref no."><select id="fk"><option value="">All types</option><option value="cert">Certificates</option><option value="slip">Payslips</option><option value="year">Yearly certificates</option></select></div><div id="tb"></div></div>`;
 const draw=()=>{const q=$('#q').value.toLowerCase(),rows=D.cert_history.filter(h=>(!q||((h.employee_name||'')+' '+(h.ref_no||'')).toLowerCase().includes(q))&&(!$('#fk').value||h.kind==$('#fk').value));
  $('#tb').innerHTML=`<table><tr><th>Issued</th><th>Type</th><th>Employee</th><th>Period</th><th>Ref no.</th><th></th></tr>${rows.map(h=>`<tr><td>${h.issued_at}</td><td>${h.kind=='cert'?'Certificate':h.kind=='year'?'Yearly certificate':'Payslip'}</td><td>${h.employee_name}</td><td>${h.kind=='year'?(h.month=='Yearly'?'Yearly '+h.year:h.month):h.month+' '+h.year}</td><td>${h.ref_no||''}</td><td style="text-align:right"><button data-r="${h.id}">Reprint</button> <button class="del" data-d="${h.id}">Delete</button></td></tr>`).join('')||'<tr><td class="empty" colspan=6>Nothing printed yet. Anything you print is saved here.</td></tr>'}</table>`;bind('cert_history',rows)};
 $('#q').oninput=$('#fk').oninput=draw;draw()}
function backup(){$('#hrv').innerHTML=`<div class="card"><b>Download backup</b><p>Saves employees, salary statements, certificate history and settings in one file. Keep it somewhere safe.</p><a class="pri" style="display:inline-block;text-decoration:none;border-radius:12px" href="/api/hr/backup/download">Download backup</a></div>
 <div class="card"><b>Restore from backup</b><p>This replaces all current data with the contents of the backup file.</p><input type="file" id="rf" accept=".json" style="max-width:360px"> <button class="pri" id="rs">Restore</button><p id="rm"></p></div>`;
 $('#rs').onclick=async()=>{const f=$('#rf').files[0];if(!f)return $('#rm').textContent='Choose a backup file first.';if(!confirm('Replace ALL current data with this backup?'))return;
  let body;try{body=await f.text();JSON.parse(body)}catch{return $('#rm').textContent='This file is not a valid backup.'}
  const r=await fetch('/api/hr/backup/restore',{method:'POST',headers:{'Content-Type':'application/json'},body}).then(r=>r.json());$('#rm').textContent=r.error||'Backup restored.';if(!r.error)await load()}}
const csv=t=>{const r=[];let row=[],c='',q=0;t=t.replace(/^\uFEFF/,'');for(let i=0;i<t.length;i++){const ch=t[i];if(q){if(ch=='"'){if(t[i+1]=='"'){c+='"';i++}else q=0}else c+=ch}else if(ch=='"')q=1;else if(ch==','){row.push(c);c=''}else if(ch=='\n'||ch=='\r'){if(ch=='\r'&&t[i+1]=='\n')i++;row.push(c);c='';if(row.some(x=>x.trim()))r.push(row);row=[]}else c+=ch}row.push(c);if(row.some(x=>x.trim()))r.push(row);return r};
const nd=s=>{s=(s||'').trim();let m;if(m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))return`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;if(m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))return`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
 if(m=s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/)){const mo=MON.findIndex(x=>x.slice(0,3).toLowerCase()==m[2].toLowerCase())+1;if(mo)return`${m[3].length==2?'20'+m[3]:m[3]}-${String(mo).padStart(2,'0')}-${m[1].padStart(2,'0')}`}return null};
function importer(){const hdr='emp_code,name,gender,designation,department,join_date,job_status,bank_name,account_no,nid,nationality,gross_salary,tin,salary_category,payment_mode';let recs=[];
 $('#hm').hidden=false;$('#hm').innerHTML=`<div class="box"><h3>Import employees</h3><p>Use a CSV file (in Excel: File → Save As → CSV). Dates can be DD-MM-YYYY, YYYY-MM-DD or 01-Sep-18. New departments and designations are created automatically. Codes that already exist are skipped.</p><p><a id="tp" download="employee-template.csv" href="#">Download CSV template</a></p><input type="file" id="fi" accept=".csv"><p id="ipv"></p><div class="act" style="display:flex"><button type="button" id="x">Cancel</button><button class="pri" id="go" disabled>Import employees</button></div></div>`;
 $('#tp').href='data:text/csv;charset=utf-8,'+encodeURIComponent(hdr+'\nE001,Md. Nazmul Haque Babul,Male,Executive,Commercial,01-09-2018,Permanent,City Bank,115103461384,,Bangladeshi,48500,100000001000,Monthly Salaried,Bank Transfer\n');
 $('#x').onclick=()=>$('#hm').hidden=true;
 $('#fi').onchange=async ev=>{const R=csv(await ev.target.files[0].text()),H=R[0].map(x=>x.trim().toLowerCase()),g=(r,...ks)=>{for(const k of ks){const i=H.indexOf(k);if(i>=0)return(r[i]||'').trim()}return''};
  const have=new Set(D.employees.map(e=>e.emp_code).filter(Boolean));let skip=0;recs=[];
  for(const r of R.slice(1)){const name=g(r,'name'),code=g(r,'emp_code');if(!name||(code&&have.has(code))){skip++;continue}have.add(code);
   recs.push({emp_code:code,name,gender:/^f/i.test(g(r,'gender'))?'Female':'Male',designation:g(r,'designation'),department:g(r,'department'),join_date:nd(g(r,'join_date')),job_status:g(r,'job_status')||'Permanent',bank_name:g(r,'bank_name'),account_no:g(r,'account_no'),nid:g(r,'nid'),nationality:g(r,'nationality')||'Bangladeshi',tin:g(r,'tin'),salary_category:g(r,'salary_category')||'Monthly Salaried',payment_mode:g(r,'payment_mode')||'Bank Transfer',total:+g(r,'gross_salary','gross','total').replace(/,/g,'')||0})}
  $('#ipv').innerHTML=`<b>${recs.length}</b> employees ready to import, ${skip} skipped (no name, or code already exists).`+(recs.some(r=>!r.join_date)?'<br>Some rows have a missing or unreadable joining date.':'');$('#go').disabled=!recs.length};
 $('#go').onclick=async()=>{$('#go').disabled=true;const id={};
  for(const[t,f]of[['departments','department'],['designations','designation']]){id[t]={};D[t].forEach(o=>id[t][o.name.toLowerCase()]=o.id);for(const n of new Set(recs.map(r=>r[f]).filter(Boolean)))if(!id[t][n.toLowerCase()])id[t][n.toLowerCase()]=(await api('POST',t,{name:n})).id}
  for(const r of recs){const{designation,department,...b}=r;b.designation_id=id.designations[designation.toLowerCase()]||'';b.department_id=id.departments[department.toLowerCase()]||'';await api('POST','employees',b)}
  $('#hm').hidden=true;go('employees')}}
function sform(r={}){const H=heads(),it=r.items?JSON.parse(r.items):{e:H.e.map(x=>[x[0],'']),d:H.d.map(n=>[n,''])};
 const ln=(k,n,a)=>`<div class="ln"><span>${n}</span><input type="number" data-k="${k}" data-n="${n}" value="${a||''}"></div>`;
 const sel=(n,o,v)=>`<select name="${n}">${o.map(x=>`<option ${x==v?'selected':''}>${x}</option>`).join('')}</select>`;
 $('#hm').hidden=false;
 $('#hm').innerHTML=`<div class="box" style="width:760px"><h3>${r.id?'Edit':'Add'} · Salary statement</h3><form>
 <div><label>Employee</label>${inp(['employee_id','','@employees'],r.employee_id)}</div><div><label>Reference no.</label><input name="ref_no" value="${r.ref_no||''}" placeholder="Auto"></div><div id="ei" style="grid-column:1/-1"></div>
 <div><label>Month</label>${sel('month',MON,r.month||MON[new Date().getMonth()])}</div><div><label>Year</label>${sel('year',YRS,r.year||yr)}</div>
 <div><label>Issue date</label><input name="issue_date" type="date" value="${r.issue_date||tdy()}"></div><div><label>Signatory</label>${inp(['signatory_id','','@signatories'],r.signatory_id)}</div>
 <div><b>Earnings</b><div id="le">${it.e.map(x=>ln('e',...x)).join('')}</div><button type="button" data-add="e">+ Add allowance</button> <button type="button" id="rc">Recalculate from gross</button></div>
 <div><b>Deductions</b> <small style="color:var(--mu)">(income tax: type manually)</small><div id="ld">${it.d.map(x=>ln('d',...x)).join('')}</div><button type="button" data-add="d">+ Add deduction</button></div>
 <div id="tt" style="grid-column:1/-1"></div><div class="act"><button type="button" id="x">Cancel</button><button class="pri">Save statement</button></div></form></div>`;
 const F=$('#hm form'),sum=k=>[...F.querySelectorAll(`input[data-k=${k}]`)].reduce((a,i)=>a+(+i.value||0),0);
 const calc=()=>{const g=sum('e'),d=sum('d');$('#tt').innerHTML=`Gross ${fmt(g)} · Deductions ${fmt(d)} · <b>Net ${fmt(g-d)}</b><br><small>${words(g-d)}</small>`;return[g,d]};
 const info=()=>{const e=D.employees.find(x=>x.id==F.elements.employee_id.value);$('#ei').innerHTML=e?`<small style="color:var(--mu)">${[['Designation',nm('designations',e.designation_id)],['Department',nm('departments',e.department_id)],['Joined',dm(e.join_date)],['Status',e.job_status],['Bank account',e.account_no],['Gross',fmt(e.total)]].map(([a,b])=>`${a}: <b style="color:var(--tx)">${b||'—'}</b>`).join(' · ')}</small>`:''};
 const fill=()=>{const e=D.employees.find(x=>x.id==F.elements.employee_id.value);info();if(!e)return;H.e.forEach(([n,p])=>{const i=[...F.querySelectorAll('input[data-k=e]')].find(i=>i.dataset.n==n);if(p&&i)i.value=Math.round(e.total*p/100)});calc()};
 F.elements.employee_id.onchange=fill;$('#rc').onclick=fill;F.oninput=calc;calc();info();
 F.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const n=prompt('Name');if(n)$('#l'+b.dataset.add).insertAdjacentHTML('beforeend',ln(b.dataset.add,n,''))});
 $('#x').onclick=()=>$('#hm').hidden=true;
 F.onsubmit=async ev=>{ev.preventDefault();const[g,d]=calc(),f=Object.fromEntries(new FormData(F));if(!f.employee_id)return alert('Choose an employee first (type a name or ID).');const gl=k=>[...F.querySelectorAll(`input[data-k=${k}]`)].map(i=>[i.dataset.n,i.value||'']);
  const b={employee_id:f.employee_id,month:f.month,year:f.year,ref_no:f.ref_no,issue_date:f.issue_date,signatory_id:f.signatory_id,items:JSON.stringify({e:gl('e'),d:gl('d')}),gross:g,deductions:d,net:g-d};
  if(!b.ref_no)b.ref_no=(await nextRefs(1,b.issue_date))[0]||'';await(r.id?api('PUT','statements/'+r.id,b):api('POST','statements',b));$('#hm').hidden=true;go('statements')}}
function bulk(){const H=heads(),tx=H.d.find(n=>/income tax/i.test(n)),now=new Date();
 const sel=(n,o,v)=>`<select name="${n}">${o.map(x=>`<option ${x==v?'selected':''}>${x}</option>`).join('')}</select>`;
 $('#hm').hidden=false;
 $('#hm').innerHTML=`<div class="box" style="width:820px"><h3>Bulk generate salary statements</h3><form>
 <div><label>Month</label>${sel('month',MON,MON[now.getMonth()])}</div><div><label>Year</label>${sel('year',YRS,yr)}</div>
 <div><label>Issue date</label><input name="issue_date" type="date" value="${now.toISOString().slice(0,10)}"></div><div><label>Signatory</label>${inp(['signatory_id','','@signatories'])}</div>
 <div style="grid-column:1/-1"><small style="color:var(--mu)">Reference numbers are assigned automatically using the numbering rule in Settings.</small></div>
 <div style="grid-column:1/-1"><input id="bs" placeholder="Search employee name or ID…"></div><div style="grid-column:1/-1;max-height:300px;overflow:auto"><table id="bt"></table></div>
 <div class="act"><span id="er" style="margin-right:auto;color:var(--red)"></span><button type="button" id="x">Cancel</button><button class="pri">Generate statements</button></div></form></div>`;
 const F=$('#hm form'),same=()=>D.statements.filter(s=>s.month==F.elements.month.value&&s.year==F.elements.year.value);
 const draw=()=>{const ex=new Set(same().map(s=>s.employee_id));
  $('#bt').innerHTML=`<tr><th><input type="checkbox" id="all" checked></th><th>Employee</th><th>Gross</th>${tx?`<th>${tx}</th>`:''}<th></th></tr>`+[...D.employees].reverse().map(e=>{const ok=+e.total>0&&!ex.has(e.id);return`<tr data-id="${e.id}"><td><input type="checkbox" class="ck" ${ok?'checked':'disabled'}></td><td>${lab('employees',e)}</td><td>${fmt(e.total)}</td>${tx?'<td><input type="number" class="tx" style="width:100px;margin:0"></td>':''}<td>${ex.has(e.id)?'Already exists':+e.total>0?'':'No gross salary'}</td></tr>`}).join('');
  $('#all').onchange=ev=>F.querySelectorAll('tr[data-id]:not([hidden]) .ck:not(:disabled)').forEach(c=>c.checked=ev.target.checked)};
 const sf=()=>{const q=$('#bs').value.toLowerCase();F.querySelectorAll('tr[data-id]').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q))};$('#bs').oninput=sf;F.elements.month.onchange=F.elements.year.onchange=()=>{draw();sf()};draw();$('#x').onclick=()=>$('#hm').hidden=true;
 F.onsubmit=async ev=>{ev.preventDefault();const rows=[...F.querySelectorAll('tr[data-id]')].filter(r=>r.querySelector('.ck').checked&&!r.hidden);
  if(!rows.length)return $('#er').textContent='Select at least one employee.';
  const refs=await nextRefs(rows.length,F.elements.issue_date.value);if(!refs[0])return $('#er').textContent='Could not create reference numbers.';let k=0;
  for(const r of rows){const e=D.employees.find(x=>x.id==r.dataset.id),t=+(r.querySelector('.tx')?.value)||0;
   const E=H.e.map(([n,p])=>[n,p?String(Math.round(e.total*p/100)):'']),Dd=H.d.map(n=>[n,n==tx&&t?String(t):'']),g=E.reduce((a,x)=>a+(+x[1]||0),0);
   await api('POST','statements',{employee_id:e.id,month:F.elements.month.value,year:F.elements.year.value,ref_no:refs[k++],issue_date:F.elements.issue_date.value,signatory_id:F.elements.signatory_id.value,items:JSON.stringify({e:E,d:Dd}),gross:g,deductions:t,net:g-t})}
  $('#hm').hidden=true;go('statements')}}
const ctxOf=r=>{const e=D.employees.find(x=>x.id==r.employee_id)||{};return{r,c:D.company[0]||{},e:{...e,designation:nm('designations',e.designation_id),department:nm('departments',e.department_id)},sg:D.signatories.find(x=>x.id==r.signatory_id)||{}}};
const m2=n=>Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const blankLn='<span class="pd-line" style="min-width:230px"></span>';
const itemsOf=r=>{try{const it=JSON.parse(r.items||'{}');return{E:(it.e||[]).filter(x=>x&&+x[1]>0),Dd:(it.d||[]).filter(x=>x&&+x[1]>0)}}catch{return{E:[],Dd:[]}}};
const cardHtml=(title,h2,rows,totLabel,tot,min)=>{const b=rows.map(([n,a])=>`<div class="ln"><span>${esc(n)}</span><span class="a">${m2(a)}</span></div>`);while(b.length<min)b.push('<div class="ln"><span>&nbsp;</span></div>');
 return`<div class="pd-card"><div class="h"><span>${title}</span><span>${h2}</span></div>${b.join('')}<div class="tt"><span>${totLabel}</span><span>${m2(tot)}</span></div></div>`};
const gridHtml=l=>`<div class="pd-grid">${l.map(([a,b])=>`<div><span>${a}</span><b>${esc(b||'—')}</b></div>`).join('')}</div>`;
const dmy=s=>{if(!s)return'____ / ____ / ________';const[y,m,d]=s.split('-');return`${d} / ${m} / ${y}`};
const signHtml=(sg,two,big)=>two?`<div class="pd-sign"><div>Prepared by</div><div class="gap"></div><div>Authorized Signature<div style="font-size:7.5pt;color:#6b7385;margin-top:2px">${sg.name||sg.title?'Name / Designation: '+esc([sg.name,sg.title].filter(Boolean).join(', ')):'Name / Designation: ____________________'}</div></div></div>`
 :`<div class="pd-sign${big?' big':''}"><div>Prepared by</div><div>Accounts / HR</div><div>Authorized Signature</div><div>Employee Signature</div></div>`;
// ---- payslip (same layout as the supplied payslip design, in the app colours)
function slipHtml({r,c,e}){const{E,Dd}=itemsOf(r),mi=MON.indexOf(r.month)+1,no=`PS-${r.year}${String(mi).padStart(2,'0')}-${String(r.id||0).padStart(5,'0')}`,cat=e.salary_category||'Monthly Salaried';
 const body=`<div class="pd-band"><span>Salary Month: ${esc(r.month)} ${esc(r.year)}</span><span>Payslip No.: ${no}</span></div>
 ${gridHtml([['Employee ID',e.emp_code],['Name',e.name],['Designation',e.designation],['Department',e.department],['Joining Date',e.join_date],['Salary Category',cat],['Payment Mode',e.payment_mode||'Bank Transfer'],['TIN',e.tin]])}
 <div class="pd-cols">${cardHtml('Earnings','',E,'Total Earnings',r.gross,6)}${cardHtml('Deductions','',Dd,'Total Deductions',r.deductions,6)}</div>
 <div class="pd-net"><span class="l">Net Payable Salary</span><span class="v">Tk. ${m2(r.net)}</span></div><div class="pd-words"><small>In words</small>${esc(takaWords(r.net))}</div>${signHtml({},false,true)}`;
 return pdocSync(c,'PAYSLIP',cat,body,{foot:'Computer-generated payslip.'})}
// ---- salary certificate (same layout as the supplied certificate template)
function certHtml({r,c,e,sg}){const{E,Dd}=itemsOf(r),cat=e.salary_category||'Monthly Salaried',mr=e.gender=='Female'?'Ms.':'Mr.',st=(e.job_status||'Permanent').toLowerCase();
 const body=`<div class="pd-band"><span>Ref. No.: ${esc(r.ref_no)||'____________________'}</span><span>Date: ${dmy(r.issue_date)}</span></div>
 <div class="pd-text"><h4 style="color:#1d2433">To Whom It May Concern</h4>This is to certify that <b>${mr} ${esc(e.name)}</b>, Employee ID <b>${esc(e.emp_code||'—')}</b>, is employed with <b>${esc(c.name||'the company')}</b> as <b>${esc(e.designation||'—')}</b> in the <b>${esc(e.department||'—')}</b> department since <b>${esc(fdate(e.join_date))}</b>. The employee is currently on the company payroll as a ${esc(st)}, ${esc(cat.toLowerCase())} employee.</div>
 ${gridHtml([['Employee Name',e.name],['Employee ID',e.emp_code],['Designation',e.designation],['Department',e.department],['Joining Date',fdate(e.join_date)],['Salary Category',cat],['TIN',e.tin],['Payment Mode',e.payment_mode||'Bank Transfer']])}
 <div class="pd-cols">${cardHtml('Earnings','Tk.',E,'Gross Monthly Salary',r.gross,4)}${cardHtml('Deductions','Tk.',Dd,'Total Deductions',r.deductions,4)}</div>
 <div class="pd-net"><span class="l">Net Payable Salary (per month)</span><span class="v">Tk. ${m2(r.net)}</span></div><div class="pd-words"><small>In words</small>${esc(takaWords(r.net))}</div>
 <div class="pd-text">This certificate is issued at the request of the employee for the purpose of <span class="pd-purpose">${r.purpose?esc(r.purpose):blankLn}</span> and carries no financial liability on the part of the company.</div>${signHtml(sg||{},true)}`;
 return pdocSync(c,'SALARY CERTIFICATE','Employment & Salary Verification',body,{foot:'Computer-generated certificate.',dense:true})}
function docHtml(x,kind){return kind=='year'?yearHtml(x):kind=='cert'?certHtml(x):slipHtml(x)}
// ---- preview: every payroll document opens in the shared print preview first
function docPreview(xs,kind,o={}){const cert=kind!='slip';
 const yy=r=>String(r.year).slice(2),one=xs.length==1,x0=xs[0],lab={slip:'Payslip',cert:'Salary Certificate',year:'Yearly Salary Certificate'}[kind],
  mo=[...new Set(xs.map(x=>x.r.month+'-'+yy(x.r)))],title=one?`${lab} — ${x0.e.name} (${kind=='year'?x0.r.period:x0.r.month+'-'+yy(x0.r)})`:`${xs.length} ${lab.toLowerCase()}s${mo.length==1&&kind!='year'?' — '+mo[0]:''}`;
 pvOpen({docs:xs.map(x=>docHtml(x,kind)),title,key:kind,keyLabel:{slip:'payslips',cert:'salary certificates',year:'yearly certificates'}[kind],note:o.note,fit:kind=='slip',
  controls:cert?`<label>Purpose of certificate</label> <input id="pvpurp" placeholder="e.g. bank loan, visa application" value="${esc(xs[0].r.purpose||'')}">`:'',
  onReady:()=>{if(!cert)return;$('#pvpurp').oninput=ev=>{const v=ev.target.value;xs.forEach(x=>x.r.purpose=v);document.querySelectorAll('#pvp .pd-purpose').forEach(el=>el.innerHTML=v?esc(v):blankLn)}},
  onPrint:async()=>{if(o.pre)await o.pre();if(o.log!==false)for(const x of xs)await logPrint(x,kind)}})}
async function logPrint(x,kind){const snapshot=JSON.stringify(x);if(D.cert_history.some(h=>h.statement_id==x.r.id&&h.kind==kind&&h.snapshot==snapshot))return;
 await api('POST','cert_history',{statement_id:x.r.id,kind,employee_name:x.e.name,month:x.r.month,year:x.r.year,ref_no:x.r.ref_no,snapshot});D.cert_history.unshift({statement_id:x.r.id,kind,snapshot})}

// ---------- yearly salary certificate ----------
const startMonth=()=>{const m=+String((typeof SET!='undefined'&&SET.fiscal_start)||'07-01').split('-')[0];return m>=1&&m<=12?m:7};
function yctx(empId,type,Y,fill,issue,sgId){
 const e=D.employees.find(x=>x.id==empId)||{},sm=type=='fy'?startMonth():1,months=[];
 for(let i=0;i<12;i++){const m0=sm-1+i;months.push([+Y+Math.floor(m0/12),m0%12+1])}
 const rows=months.map(([y,m])=>{const label=`${MON[m-1]} ${y}`,st=D.statements.find(t=>t.employee_id==empId&&t.month==MON[m-1]&&t.year==y);
  if(st)return{label,gross:+st.gross,ded:+st.deductions,net:+st.net};
  if(fill&&+e.total>0&&!(e.join_date&&e.join_date.slice(0,7)>`${y}-${String(m).padStart(2,'0')}`))return{label,gross:+e.total,ded:0,net:+e.total};
  return{label,none:1}});
 const got=rows.filter(x=>!x.none),sum=k=>got.reduce((a,x)=>a+x[k],0),fy=type=='fy'&&sm>1;
 const r={id:undefined,ref_no:'',issue_date:issue,signatory_id:sgId,month:fy?`FY ${String(Y).slice(2)}-${String(+Y+1).slice(2)}`:'Yearly',year:+Y,period:`${rows[0].label} to ${rows[11].label}`,rows,count:got.length,gross:sum('gross'),deductions:sum('ded'),net:sum('net')};
 return{r,c:D.company[0]||{},e:{...e,designation:nm('designations',e.designation_id),department:nm('departments',e.department_id)},sg:D.signatories.find(x=>x.id==sgId)||{}}}
function yearHtml({r,c,e,sg}){const mr=e.gender=='Female'?'Ms.':'Mr.',rows=r.rows.map(x=>`<tr><td>${x.label}</td><td class="n">${x.none?'—':m2(x.gross)}</td><td class="n">${x.none?'—':m2(x.ded)}</td><td class="n">${x.none?'—':m2(x.net)}</td></tr>`).join('');
 const body=`<div class="pd-band"><span>Ref. No.: ${esc(r.ref_no)||'____________________'}</span><span>Date: ${dmy(r.issue_date)}</span></div>
 <div class="pd-text"><h4 style="color:#1d2433">To Whom It May Concern</h4>This is to certify that <b>${mr} ${esc(e.name)}</b>${e.designation?`, ${esc(e.designation)}`:''}${e.department?` (${esc(e.department)})`:''}${e.join_date?`, joined <b>${esc(c.name)}</b> on ${esc(fdate(e.join_date))}`:''}. According to our records, the salary paid for the period <b>${esc(r.period)}</b> is as follows:</div>
 ${gridHtml([['Employee Name',e.name],['Employee ID',e.emp_code],['Designation',e.designation],['Department',e.department],['Joining Date',fdate(e.join_date)],['Salary Category',e.salary_category||'Monthly Salaried'],['TIN',e.tin],['Payment Mode',e.payment_mode||'Bank Transfer']])}
 <div class="pd-card mb"><table class="pd-tbl compact"><thead><tr><th>Month</th><th class="n">Gross Earning (Tk.)</th><th class="n">Total Deduction (Tk.)</th><th class="n">Net Salary (Tk.)</th></tr></thead><tbody>${rows}<tr class="tot"><td>Total (${r.count} month${r.count==1?'':'s'})</td><td class="n">${m2(r.gross)}</td><td class="n">${m2(r.deductions)}</td><td class="n">${m2(r.net)}</td></tr></tbody></table></div>
 <div class="pd-net"><span class="l">Total Net Salary Paid</span><span class="v">Tk. ${m2(r.net)}</span></div><div class="pd-words"><small>In words</small>${esc(takaWords(r.net))}</div>
 <div class="pd-text">This certificate is issued at the request of the employee for the purpose of <span class="pd-purpose">${r.purpose?esc(r.purpose):blankLn}</span> and carries no financial liability on the part of the company.</div>${signHtml(sg||{},true)}`;
 return pdocSync(c,'YEARLY SALARY CERTIFICATE',r.period,body,{foot:'Computer-generated certificate.',dense:true})}
function ylist(){
 const sm=startMonth(),Ys=Array.from({length:12},(_,i)=>yr+1-i);
 $('#hrv').innerHTML=`<div class="card"><p style="margin-top:0;color:var(--mu)">Creates a yearly salary certificate from the saved monthly salary statements. Any past year can be printed at any time. Every printed certificate is saved in Certificate history.</p>
 <form id="yf"><div><label>Employee</label>${inp(['employee_id','','@employees'])}</div>
 <div><label>Year type</label><select name="ytype"><option value="cal">Calendar year (January – December)</option>${sm>1?`<option value="fy">Fiscal year (${MON[sm-1]} – ${MON[(sm+10)%12]})</option>`:''}</select></div>
 <div><label>Year</label><select name="year"></select></div><div><label>Issue date</label><input type="date" name="issue_date" value="${tdy()}"></div>
 <div><label>Signatory</label>${inp(['signatory_id','','@signatories'])}</div><div></div>
 <div style="grid-column:1/-1"><label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" name="fill" style="width:auto;margin:0"> Include months that have no saved statement (uses the current monthly gross salary, no deductions)</label></div>
 <div id="ysum" style="grid-column:1/-1;color:var(--mu)"></div>
 <div class="act"><button type="button" id="yall">Print for all employees</button><button type="button" class="pri" id="ypv">Preview &amp; print</button></div></form></div>`;
 const F=$('#yf'),fill=()=>{const fy=F.elements.ytype.value=='fy',cur=F.elements.year.value||String(fy&&new Date().getMonth()+1<sm?yr-1:yr);
  F.elements.year.innerHTML=Ys.map(y=>`<option value="${y}" ${y==cur?'selected':''}>${fy?`${y}-${String(y+1).slice(2)}`:y}</option>`).join('')};
 const x=()=>yctx(F.elements.employee_id.value,F.elements.ytype.value,F.elements.year.value,F.elements.fill.checked,F.elements.issue_date.value,F.elements.signatory_id.value);
 const sum=()=>{if(!F.elements.employee_id.value){$('#ysum').textContent='';return}const r=x().r;$('#ysum').innerHTML=`${r.period}: <b>${r.count}</b> of 12 months have salary data · Gross ${fmt(r.gross)} · Net <b>${fmt(r.net)}</b>`+(r.count<12?' <span style="color:var(--red)">(missing months are shown as — on the certificate)</span>':'')};
 fill();F.elements.ytype.onchange=()=>{F.elements.year.innerHTML='';fill();sum()};F.onchange=sum;F.oninput=e=>{if(e.target.type=='checkbox')sum()};
 $('#ypv').onclick=()=>{if(!F.elements.employee_id.value)return alert('Choose an employee first (type a name or ID).');const y=x();
  if(!y.r.count)return alert('No salary statements found for this employee in that period. Tick "Include months that have no saved statement" or create salary statements first.');
  docPreview([y],'year',{pre:async()=>{if(!y.r.ref_no){y.r.ref_no=(await nextRefs(1,y.r.issue_date))[0]||'';document.querySelectorAll('#pvp .pdoc').forEach((d,i)=>d.outerHTML=docHtml(y,'year'))}}})};
 $('#yall').onclick=()=>{const xs=D.employees.slice().reverse().map(e=>yctx(e.id,F.elements.ytype.value,F.elements.year.value,F.elements.fill.checked,F.elements.issue_date.value,F.elements.signatory_id.value)).filter(y=>y.r.count);
  if(!xs.length)return alert('No employee has salary statements in that period.');
  docPreview(xs,'year',{note:`${xs.length} yearly certificates, one per page`,pre:async()=>{if(!xs[0].r.ref_no){const refs=await nextRefs(xs.length,F.elements.issue_date.value);if(!refs[0])return;xs.forEach((y,i)=>y.r.ref_no=refs[i]);document.querySelectorAll('#pvp .pdoc').forEach((d,i)=>d.outerHTML=docHtml(xs[i],'year'))}}})}}
const sdoc=(r,kind)=>docPreview([ctxOf(r)],kind);
function printAll(rows,kind){if(!rows.length)return alert('No statements match the current filter.');const xs=rows.map(ctxOf);docPreview(xs,kind,{note:`${xs.length} ${kind=='cert'?'certificates':'payslips'}, one per page`})}
const reprint=h=>docPreview([JSON.parse(h.snapshot)],h.kind,{note:`Issued ${h.issued_at}`,log:false});
const numCfg=()=>{try{return{p:'HR/{YYYY}/{N}',pad:4,reset:'year',...JSON.parse(D.company[0].heads).num}}catch{return{p:'HR/{YYYY}/{N}',pad:4,reset:'year'}}};
const fmtRef=(c,date,n)=>{const[y,m]=(date||tdy()).split('-');return c.p.replace(/\{YYYY\}/g,y).replace(/\{YY\}/g,y.slice(2)).replace(/\{MM\}/g,m).replace(/\{N\}/g,String(n).padStart(c.pad,'0'))};
async function nextRefs(count,date){const c=numCfg(),r=await api('POST','ref/next',{count,reset:c.reset,date});if(r.error){alert('Numbering error: '+r.error);return[]}return Array.from({length:count},(_,i)=>fmtRef(c,date,r.from+i))}
function settings(){const nc=numCfg(),today=tdy();let orig=0;const c=D.company[0]||{},H=heads(),f=[['name','Company name'],['address','Address'],['phone','Phone'],['email','Email'],['reg_no','Registration no.']];
 const x='<button type="button" class="del" onclick="this.parentNode.remove()">✕</button>';
 const er=(n,p)=>`<div class="hr"><input class="hn" value="${n}"><input class="hp" type="number" value="${p}" title="% of gross (0 = manual)">${x}</div>`,dr=n=>`<div class="hr"><input class="hn" value="${n}">${x}</div>`;
 $('#hrv').innerHTML=`<div class="card"><form id="cf">${f.map(y=>`<div><label>${y[1]}</label>${inp(y,c[y[0]])}</div>`).join('')}</form></div>
 <div class="card"><b>Salary structure</b><p style="color:var(--mu)">Earnings with a % are calculated from gross salary (keep them totalling 100%). 0% means you type the amount in each statement. All deductions, including income tax, are typed manually.</p>
 <div class="cols"><div><label>Earnings: name and %</label><div id="he">${H.e.map(y=>er(...y)).join('')}</div><button type="button" id="ae">+ Add allowance</button></div>
 <div><label>Deductions</label><div id="hd">${H.d.map(dr).join('')}</div><button type="button" id="ad">+ Add deduction</button></div></div></div><div class="card"><b>Certificate numbering</b><p style="color:var(--mu)">Reference numbers are given automatically when a statement is saved. Use {YYYY}, {YY}, {MM} for the date and {N} for the running number.</p>
 <form id="nf"><div><label>Format</label><input id="np" value="${nc.p}"></div><div><label>Number digits</label><select id="nd">${[3,4,5,6].map(x=>`<option ${x==nc.pad?'selected':''}>${x}</option>`).join('')}</select></div>
 <div><label>Restart numbering</label><select id="nr">${[['year','Every year'],['month','Every month'],['never','Never']].map(([v,l])=>`<option value="${v}" ${v==nc.reset?'selected':''}>${l}</option>`).join('')}</select></div><div><label>Next number (current period)</label><input id="nn" type="number" min="1"></div><div id="npv" style="grid-column:1/-1;color:var(--mu)"></div></form>
 <button class="pri" id="sv">Save changes</button></div>`;
 const pv=()=>$('#npv').textContent='Example: '+fmtRef({p:$('#np').value,pad:+$('#nd').value},today,+$('#nn').value||1);
 const peek=async()=>{const r=await fetch(`/api/hr/ref/peek?reset=${$('#nr').value}&date=${today}`).then(r=>r.json());$('#nn').value=orig=r.next||1;pv()};
 $('#nf').oninput=pv;$('#nr').onchange=peek;peek();
 $('#ae').onclick=()=>$('#he').insertAdjacentHTML('beforeend',er('',0));$('#ad').onclick=()=>$('#hd').insertAdjacentHTML('beforeend',dr(''));
 $('#sv').onclick=async()=>{const b=Object.fromEntries(new FormData($('#cf'))),rd=s=>[...document.querySelectorAll(s+' .hr')];
  b.heads=JSON.stringify({e:rd('#he').map(r=>[r.querySelector('.hn').value,+r.querySelector('.hp').value||0]).filter(y=>y[0]),d:rd('#hd').map(r=>r.querySelector('.hn').value).filter(Boolean),num:{p:$('#np').value,pad:+$('#nd').value,reset:$('#nr').value}});if(!$('#np').value.includes('{N}'))return alert('The format must include {N} for the running number.');await api('PUT','company/1',b);if(+$('#nn').value&&+$('#nn').value!=orig)await api('POST','ref/set',{reset:$('#nr').value,date:today,next:+$('#nn').value});go('settings')}}
const cbM=i=>{const T=i.dataset.t,q=i.value.trim().toLowerCase();return D[T].filter(o=>!q||lab(T,o).toLowerCase().includes(q)).sort((x,y)=>((y.emp_code||'').toLowerCase()==q)-((x.emp_code||'').toLowerCase()==q))};
const cbX=i=>{const T=i.dataset.t,q=i.value.trim().toLowerCase();return q&&D[T].find(o=>(o.emp_code||'').toLowerCase()==q||lab(T,o).toLowerCase()==q||o.name.toLowerCase()==q)};
const cbL=i=>{const L=i.parentNode.querySelector('.cbl'),T=i.dataset.t;L.innerHTML=cbM(i).slice(0,40).map(o=>`<div class="cbo" data-id="${o.id}">${lab(T,o)}</div>`).join('')||'<div class="cbn">No match in database</div>';L.hidden=false};
const cbS=(i,id)=>{const T=i.dataset.t,o=D[T].find(x=>x.id==id),h=i.parentNode.querySelector('input[type=hidden]');i.parentNode.querySelector('.cbl').hidden=true;i.value=o?lab(T,o):'';const nv=o?String(o.id):'';if(h.value!=nv){h.value=nv;h.dispatchEvent(new Event('change',{bubbles:true}))}};
const cbi=e=>e.target.classList?.contains('cbi')?e.target:null;
document.addEventListener('focusin',e=>{const i=cbi(e);if(i){i.select();cbL(i)}});
document.addEventListener('input',e=>{const i=cbi(e);if(i){if(!i.value.trim())cbS(i,'');cbL(i)}});
document.addEventListener('keydown',e=>{const i=cbi(e);if(i&&e.key=='Enter'){e.preventDefault();const x=cbX(i)||cbM(i)[0];if(x)cbS(i,x.id);i.blur()}});
document.addEventListener('focusout',e=>{const i=cbi(e);if(!i)return;const m=cbM(i),x=cbX(i)||(i.value.trim()&&m.length==1?m[0]:null);const h=i.parentNode.querySelector('input[type=hidden]');
 if(x)cbS(i,x.id);else{const o=D[i.dataset.t].find(o=>o.id==h.value);i.value=o?lab(i.dataset.t,o):'';i.parentNode.querySelector('.cbl').hidden=true}});
document.addEventListener('mousedown',e=>{const o=e.target.closest?.('.cbo');if(o){e.preventDefault();cbS(o.closest('.cb').querySelector('.cbi'),o.dataset.id)}});

window.addEventListener('afterprint',()=>document.body.classList.remove('hr-print'));
window.hrOpen=sub=>{
 $('#view').innerHTML='<div id="hr"><div class="hrtabs" id="hrnav"></div><div class="hrtitle"><h2 id="hrttl"></h2><span><button id="hrpr">🖨 Print preview</button> <button class="pri" id="hradd">+ Add</button></span></div><section id="hrv"></section></div>';
 $('#hradd').onclick=()=>cur=='statements'?sform():form(cur);
 $('#hrpr').onclick=()=>pvFromEl('#hrv',NAV.find(n=>n[0]==cur)[1].toUpperCase(),'Certificate & Payslip');
 return go(sub||cur||'overview')};

})();
