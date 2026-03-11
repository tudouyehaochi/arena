(() => {
const $ = (id) => document.getElementById(id);
const keyFromUrl = new URLSearchParams(location.search).get('adminKey') || '';
const authHeaders = () => keyFromUrl ? { 'x-admin-key': keyFromUrl } : {};
const esc = (s) => { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; };
const fmtBytes = (n) => { const v = Number(n||0); return v<1024?v+' B':v<1048576?(v/1024).toFixed(1)+' KB':v<1073741824?(v/1048576).toFixed(1)+' MB':(v/1073741824).toFixed(2)+' GB'; };
const levelClass = (l) => l==='CRITICAL'?'bad':l==='WARN'?'warn':'ok';
const showAdmin = (on) => { $('login-panel').className=on?'login-center hide':'login-center'; $('admin-panel').className=on?'wrap':'wrap hide'; };
const PRIORITIES=['high','medium','low'];
let agentModels={}, allowedModels=['claude','codex'], roles=[], skills=[], activeRoleIndex=0, lastAlerts=[], lastOverview={ runtime:{}, integrity:null };

async function api(path,opt={}){const res=await fetch(path,{...opt,headers:{...authHeaders(),...(opt.headers||{})}});return{res,data:await res.json().catch(()=>({}))}}
function normalizeRole(role={}){
  const sb=Array.isArray(role.skillBindings)&&role.skillBindings.length?role.skillBindings:(Array.isArray(role.skills)?role.skills.map(id=>({id,priority:'medium'})):[]);
  return{name:role.name||'',alias:Array.isArray(role.alias)?role.alias:[],model:role.model||'claude',avatar:role.avatar||((role.name||'?')[0]||'?'),color:role.color||'#64748b',enabled:role.enabled!==false,status:role.status||'idle',priority:Number(role.priority||50),activationMode:role.activationMode||'mention',skillBindings:sb.map(s=>({id:String(s.id||'').trim(),priority:PRIORITIES.includes(String(s.priority||'').toLowerCase())?String(s.priority).toLowerCase():'medium'})).filter(s=>s.id),persona:String(role.persona||'').trim()};
}
function parsePersona(p){const out={position:'',style:'',strength:'',boundary:''};if(!p)return out;for(const l of String(p).split(/[。;\n]/).map(s=>s.trim()).filter(Boolean)){if(l.startsWith('定位:'))out.position=l.slice(3).trim();else if(l.startsWith('风格:'))out.style=l.slice(3).trim();else if(l.startsWith('擅长:'))out.strength=l.slice(3).trim();else if(l.startsWith('边界:'))out.boundary=l.slice(3).trim();}if(!out.position&&!out.style&&!out.strength&&!out.boundary)out.position=String(p);return out;}
function buildPersona(){const parts=[];['position','style','strength','boundary'].forEach(k=>{const v=$('persona-'+k).value.trim();if(v)parts.push(`${{position:'定位',style:'风格',strength:'擅长',boundary:'边界'}[k]}:${v}`);});return parts.join('；');}
function renderMetric(l,v,d){return`<div class="metric"><div class="label">${esc(l)}</div><div class="value">${esc(v)}</div>${d?`<div class="desc">${esc(d)}</div>`:''}</div>`;}

function renderRuntimeOverview(data){
  const r=data.runtime||{};
  $('runtime').innerHTML=[renderMetric('Redis',r.redisReady?'READY':'DOWN',`${r.redisVersion||''} · ${r.connectedClients||0} clients`),renderMetric('Rooms',data.rooms?.total||0,'活跃房间数'),renderMetric('Memory',r.usedMemoryHuman||fmtBytes(r.usedMemory),`AOF: ${r.aofEnabled?'ON':'OFF'}`),renderMetric('Integrity',data.integrity?(data.integrity.ok?'PASS':'FAIL'):'未检查',data.integrity?`issues: ${(data.integrity.issues||[]).length}`:'点击校验按钮')].join('');
}
function renderIntegrityBanner(integ){
  if(!integ){$('integrity').innerHTML='<div class="integrity-banner pending">尚未运行完整性校验</div>';return;}
  const cls=integ.ok?'pass':'fail',icon=integ.ok?'✓':'✗';
  $('integrity').innerHTML=`<div class="integrity-banner ${cls}">${icon} 完整性: ${integ.ok?'PASS':'FAIL'} · rooms=${integ.roomCount||0} · messages=${integ.totalMessages||0} · issues=${(integ.issues||[]).length}</div>${integ.checkedAt?`<div class="integrity-detail">最近检查: ${esc(integ.checkedAt)}</div>`:''}`;
}
function renderRiskStrip(data){
  const b=[];
  if(data.integrity&&!data.integrity.ok)b.push(`<span class="badge bad">完整性异常: ${(data.integrity.issues||[]).length} 个问题</span>`);
  const crit=lastAlerts.filter(a=>a.level==='CRITICAL'&&!a.acked),warns=lastAlerts.filter(a=>a.level==='WARN'&&!a.acked);
  if(crit.length)b.push(`<span class="badge bad">严重告警: ${crit.length} 条</span>`);
  if(warns.length)b.push(`<span class="badge warn">警告: ${warns.length} 条</span>`);
  if(!(data.runtime||{}).redisReady)b.push('<span class="badge bad">Redis 离线</span>');
  if(!b.length)b.push('<span class="badge ok">系统正常</span>');
  $('risk-strip').innerHTML=b.join('');
}
function renderAgentModels(models,next){
  agentModels={...(models||{})};allowedModels=Array.isArray(next)&&next.length?next:allowedModels;
  const opts=allowedModels.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  $('agent-models-body').innerHTML=Object.keys(agentModels).sort().map(r=>`<tr><td>${esc(r)}</td><td><select class="input" data-agent="${esc(r)}">${opts}</select></td></tr>`).join('');
  document.querySelectorAll('[data-agent]').forEach(sel=>{sel.value=agentModels[sel.dataset.agent]||allowedModels[0]||'claude';sel.onchange=()=>{agentModels[sel.dataset.agent]=sel.value;};});
}
function renderRoleList(){
  $('role-list').innerHTML=roles.map((r,i)=>{const ac=(r.alias||[]).length,sc=(r.skillBindings||[]).length;return`<div class="role-item ${i===activeRoleIndex?'active':''}" data-role-idx="${i}"><div><strong>${esc(r.name||'未命名')}</strong> <span class="pill">${esc(r.activationMode)}</span></div><div class="hint">${esc(r.model)} · p${esc(r.priority)} · ${r.enabled?'enabled':'disabled'}</div><div class="role-meta">${ac?`<span class="pill">${ac} 别名</span>`:''}${sc?`<span class="pill">已选 ${sc} skill</span>`:'<span class="pill">无 skill</span>'}</div></div>`;}).join('');
  document.querySelectorAll('[data-role-idx]').forEach(el=>{el.onclick=()=>{activeRoleIndex=Number(el.dataset.roleIdx||0);renderRoleList();renderRoleEditor();};});
}
function selectedRole(){if(!roles.length)roles.push(normalizeRole({name:'新角色'}));if(activeRoleIndex>=roles.length)activeRoleIndex=roles.length-1;return roles[activeRoleIndex];}
function applyFormToRole(){
  const r=selectedRole();r.name=$('role-name').value.trim();r.avatar=$('role-avatar').value.trim().slice(0,2)||((r.name||'?')[0]||'?');r.color=$('role-color').value.trim()||'#64748b';r.alias=$('role-alias').value.split(',').map(s=>s.trim()).filter(Boolean).slice(0,8);r.model=$('role-model').value;r.status=$('role-status').value;r.priority=Math.max(1,Math.min(100,Number($('role-priority').value||50)));r.activationMode=$('role-activation-mode').value;r.enabled=r.status!=='muted';r.persona=buildPersona();
  const b=[];document.querySelectorAll('[data-skill-check]').forEach(cb=>{if(!cb.checked)return;const id=cb.dataset.skillCheck,ps=document.querySelector(`[data-skill-priority="${CSS.escape(id)}"]`);b.push({id,priority:PRIORITIES.includes(ps?.value||'')?ps.value:'medium'});});r.skillBindings=b;
}
function renderSkillList(ft=''){
  const r=selectedRole(),active=new Map((r.skillBindings||[]).map(s=>[s.id,s.priority])),q=String(ft||'').trim().toLowerCase();
  const list=skills.filter(s=>!q||`${s.id} ${s.name} ${s.description}`.toLowerCase().includes(q));
  $('skill-list').innerHTML=list.map(s=>{const ch=active.has(s.id),pr=active.get(s.id)||s.recommendedPriority||'medium',opts=PRIORITIES.map(p=>`<option value="${p}" ${p===pr?'selected':''}>${p}</option>`).join('');return`<label class="skill-item"><input type="checkbox" data-skill-check="${esc(s.id)}" ${ch?'checked':''}><div><div><strong>${esc(s.id)}</strong> <span class="pill">建议 ${esc(s.recommendedPriority||'medium')}</span></div><div class="hint">${esc(s.description||'')}</div></div><select class="input" data-skill-priority="${esc(s.id)}">${opts}</select><span class="hint">${esc(s.source||'')}</span></label>`;}).join('');
}
function renderRoleEditor(){const r=selectedRole(),p=parsePersona(r.persona);$('role-name').value=r.name||'';$('role-avatar').value=r.avatar||'';$('role-color').value=r.color||'';$('role-alias').value=(r.alias||[]).join(', ');$('role-model').value=r.model||'claude';$('role-status').value=r.status||'idle';$('role-priority').value=r.priority||50;$('role-activation-mode').value=r.activationMode||'mention';$('persona-position').value=p.position;$('persona-style').value=p.style;$('persona-strength').value=p.strength;$('persona-boundary').value=p.boundary;renderSkillList($('skill-filter').value);}
function renderAlerts(items){
  lastAlerts=items||[];
  $('alerts').innerHTML=(items||[]).map(a=>`<tr><td>${esc(a.ts)}</td><td class="${levelClass(a.level)}">${esc(a.level)}</td><td>${esc(a.event)}</td><td>${esc(JSON.stringify(a.detail||{}))}</td><td>${esc(a.ackedBy||'')}</td><td>${esc(a.ackedAt||'')}</td><td>${a.acked?'已确认':`<button class="btn" data-ack="${esc(a.id)}">确认</button>`}</td></tr>`).join('');
  renderRiskStrip(lastOverview);
  document.querySelectorAll('[data-ack]').forEach(b=>b.onclick=async()=>{const r=await api('/api/admin/alerts/ack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.ack,actor:$('username').value||'admin'})});if(!r.res.ok){alert('确认失败');return;}queryAlerts().catch(()=>{});});
}
function renderBootstrap(data){
  $('stamp').textContent='更新时间: '+new Date().toLocaleString();
  lastOverview={ runtime:data.runtime||{}, integrity:data.integrity||null };
  renderRuntimeOverview(data);renderIntegrityBanner(data.integrity);renderAgentModels(data.agentModels||{},data.allowedModels||['claude','codex']);
  skills=Array.isArray(data.skills)?data.skills:[];roles=(data.roles||[]).map(normalizeRole).sort((a,b)=>Number(b.priority||0)-Number(a.priority||0));activeRoleIndex=0;
  renderRoleList();renderRoleEditor();renderAlerts(data.alerts||[]);renderRiskStrip(data);
  $('backups').innerHTML=(data.backups||[]).map(b=>`<tr><td>${esc(b.name)}</td><td>${esc(fmtBytes(b.size))}</td><td>${esc(b.mtime)}</td></tr>`).join('');
  const bt=data.backupTask,rd=data.restoreDrill,sp=[];if(bt)sp.push(`backup: ${bt.status} ${bt.finishedAt||''}`);if(rd)sp.push(`restore: ${rd.status} ${rd.finishedAt||''}`);$('backup-status').textContent=sp.join(' | ');
}
async function load(){const{res,data}=await api('/api/admin/bootstrap');if(!res.ok){showAdmin(false);$('login-msg').textContent='请先登录';return;}showAdmin(true);renderBootstrap(data);}
async function queryAlerts(){const{res,data}=await api('/api/admin/alerts/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:200,filters:{acked:$('alert-acked').value,q:$('alert-q').value.trim()}})});if(!res.ok){alert('查询告警失败: '+(data.error||res.status));return;}renderAlerts(data.alerts||[]);}

$('login').onclick=async()=>{const u=$('username').value.trim(),p=$('password').value;const{res,data}=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})}).then(async r=>({res:r,data:await r.json().catch(()=>({}))}));if(!res.ok){$('login-msg').textContent='登录失败: '+(data.error||res.status);return;}$('login-msg').textContent='';load().catch(()=>{});};
$('logout').onclick=async()=>{await api('/api/admin/logout',{method:'POST'});showAdmin(false);};
$('refresh').onclick=()=>load().catch(e=>alert(e.message));
$('check').onclick=async()=>{const{res,data}=await api('/api/admin/check',{method:'POST'});if(!res.ok){alert('校验失败: '+(data.error||res.status));return;}load().catch(()=>{});};
$('alert-search').onclick=()=>queryAlerts().catch(()=>{});
$('save-agent-models').onclick=async()=>{const{res,data}=await api('/api/admin/agent-models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({models:agentModels})});if(!res.ok){alert('保存失败: '+(data.error||res.status));return;}load().catch(()=>{});alert('已保存，runner 会在几秒内自动刷新配置');};
$('add-role').onclick=()=>{applyFormToRole();roles.push(normalizeRole({name:`新角色${roles.length+1}`,model:'claude',status:'idle',priority:50,activationMode:'mention'}));activeRoleIndex=roles.length-1;renderRoleList();renderRoleEditor();};
$('save-roles').onclick=async()=>{applyFormToRole();const payload=roles.map(r=>({...r,enabled:r.status!=='muted',skills:(r.skillBindings||[]).map(s=>s.id),activationRules:[]}));const{res,data}=await api('/api/admin/roles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roles:payload})});if(!res.ok){alert('保存角色失败: '+(data.error||res.status));return;}load().catch(()=>{});alert('角色已保存，runner 将自动热加载');};
['role-name','role-avatar','role-priority'].forEach(id=>$(id).oninput=()=>{applyFormToRole();renderRoleList();});
['role-model','role-status','role-activation-mode'].forEach(id=>$(id).onchange=()=>{applyFormToRole();renderRoleList();});
$('skill-filter').oninput=()=>renderSkillList($('skill-filter').value);
document.addEventListener('change',e=>{const t=e.target;if(!t||typeof t.getAttribute!=='function')return;if(t.getAttribute('data-skill-check')!==null||t.getAttribute('data-skill-priority')!==null){applyFormToRole();renderRoleList();}});
$('run-backup').onclick=async()=>{const{res,data}=await api('/api/admin/backup/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:$('backup-kind').value})});if(!res.ok){alert('备份失败: '+(data.error||data.status||res.status));return;}load().catch(()=>{});};
$('run-restore-drill').onclick=async()=>{if(!confirm('恢复演练会覆盖当前 dev Redis 快照，确认继续？'))return;const{res,data}=await api('/api/admin/restore/drill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});if(!res.ok){alert('恢复演练失败: '+(data.error||data.status||res.status));return;}load().catch(()=>{});};
load().catch(()=>showAdmin(false));
})();
