/* ==========================================================================
   Fluye — Asistente de rutina y sueño
   Toda la información se guarda localmente (localStorage). Sin servidores,
   sin cuentas, sin publicidad.
   ========================================================================== */

const STORAGE_KEY = 'fluye_state_v1';

/* ---------------------------------------------------------------------- */
/* Estado y persistencia                                                  */
/* ---------------------------------------------------------------------- */

function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

function defaultState(){
  return {
    routines: [
      {
        id: uid(),
        name: 'Universidad',
        activities: [
          'Desperté','Salí de la cama','Terminé de bañarme','Terminé de cambiarme',
          'Preparé mochila','Salí de casa','Llegué al parqueo','Bajé del carro','Llegué al salón'
        ].map(name => ({ id: uid(), name }))
      }
    ],
    activeRoutineId: null,
    sessions: [],        // {id, date, routineId, logs:[{activityId,time}], completed}
    todaySessionId: null,
    durationHistory: {},  // key `${routineId}::${activityId}` -> [ms,...]
    sleepSessions: [],    // {id, mode, targetWake, sleepTime, wakeTime, cyclesPlanned, cyclesActual, energy, status}
    activeSleepSessionId: null,
    notes: []             // {id, text, date, done}
  };
}

let state = loadState();
if (!state.activeRoutineId && state.routines.length){
  state.activeRoutineId = state.routines[0].id;
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed);
  }catch(e){
    console.warn('No se pudo leer el estado guardado, iniciando limpio.', e);
    return defaultState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------------------------------------------------------------------- */
/* Utilidades de tiempo                                                    */
/* ---------------------------------------------------------------------- */

function todayKey(d = new Date()){
  return d.toISOString().slice(0,10);
}

function fmtTime(iso){
  const d = new Date(iso);
  return d.toLocaleTimeString('es-GT', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function fmtTimeShort(date){
  return date.toLocaleTimeString('es-GT', { hour:'2-digit', minute:'2-digit' });
}

function fmtDuration(ms){
  if (ms == null || isNaN(ms)) return '—';
  const totalMin = Math.round(ms/60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin/60), m = totalMin%60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function weekdayName(d){
  return d.toLocaleDateString('es-GT', { weekday:'long' });
}

function toast(msg, ms = 2200){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> el.classList.remove('show'), ms);
}

/* ---------------------------------------------------------------------- */
/* Rutinas                                                                 */
/* ---------------------------------------------------------------------- */

function getRoutine(id){
  return state.routines.find(r => r.id === id);
}

function activeRoutine(){
  return getRoutine(state.activeRoutineId);
}

function createRoutine(name){
  const r = { id: uid(), name: name || 'Nueva rutina', activities: [] };
  state.routines.push(r);
  saveState();
  return r;
}

function deleteRoutine(id){
  state.routines = state.routines.filter(r => r.id !== id);
  if (state.activeRoutineId === id){
    state.activeRoutineId = state.routines[0] ? state.routines[0].id : null;
  }
  saveState();
}

function addActivity(routineId, name){
  const r = getRoutine(routineId);
  if (!r || !name.trim()) return;
  r.activities.push({ id: uid(), name: name.trim() });
  saveState();
}

function removeActivity(routineId, activityId){
  const r = getRoutine(routineId);
  if (!r) return;
  r.activities = r.activities.filter(a => a.id !== activityId);
  saveState();
}

function moveActivity(routineId, activityId, dir){
  const r = getRoutine(routineId);
  if (!r) return;
  const i = r.activities.findIndex(a => a.id === activityId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= r.activities.length) return;
  [r.activities[i], r.activities[j]] = [r.activities[j], r.activities[i]];
  saveState();
}

/* ---------------------------------------------------------------------- */
/* Sesiones diarias — registro de un toque                                */
/* ---------------------------------------------------------------------- */

function getTodaySession(){
  if (!state.todaySessionId) return null;
  const s = state.sessions.find(s => s.id === state.todaySessionId);
  if (s && s.date !== todayKey()) return null; // sesión de otro día, ya no cuenta como "hoy"
  return s || null;
}

function startSession(routineId){
  const session = {
    id: uid(),
    date: todayKey(),
    routineId,
    logs: [],
    completed: false
  };
  state.sessions.push(session);
  state.todaySessionId = session.id;
  saveState();
  return session;
}

function logNextActivity(){
  const session = getTodaySession();
  if (!session) return;
  const routine = getRoutine(session.routineId);
  if (!routine) return;
  const nextIndex = session.logs.length;
  const activity = routine.activities[nextIndex];
  if (!activity) return;

  const now = new Date().toISOString();
  session.logs.push({ activityId: activity.id, time: now });

  // Guardar duración desde la actividad anterior para aprendizaje de hábitos
  if (nextIndex > 0){
    const prevTime = new Date(session.logs[nextIndex-1].time);
    const dur = new Date(now) - prevTime;
    const key = `${routine.id}::${activity.id}`;
    if (!state.durationHistory[key]) state.durationHistory[key] = [];
    state.durationHistory[key].push(dur);
    if (state.durationHistory[key].length > 60) state.durationHistory[key].shift();
  }

  if (session.logs.length === routine.activities.length){
    session.completed = true;
  }

  saveState();
  return activity;
}

function averageDuration(routineId, activityId){
  const key = `${routineId}::${activityId}`;
  const arr = state.durationHistory[key];
  if (!arr || !arr.length) return null;
  return arr.reduce((a,b)=>a+b,0) / arr.length;
}

/* ---------------------------------------------------------------------- */
/* Módulo 2 — Objetivo de llegada (cálculo hacia atrás)                    */
/* ---------------------------------------------------------------------- */

// Dado un tiempo objetivo (Date) para completar la última actividad de la
// rutina, calcula hacia atrás usando los promedios históricos (o un valor
// por defecto de 8 min si aún no hay datos) el horario ideal de cada paso.
function computeBackwardPlan(routineId, targetDate){
  const routine = getRoutine(routineId);
  if (!routine || !routine.activities.length) return [];
  const acts = routine.activities;
  const times = new Array(acts.length);
  times[acts.length-1] = targetDate;

  for (let i = acts.length-1; i > 0; i--){
    const avg = averageDuration(routineId, acts[i].id);
    const durationMs = avg != null ? avg : 8*60000; // valor de arranque razonable
    times[i-1] = new Date(times[i].getTime() - durationMs);
  }

  return acts.map((a,i) => ({ activity: a, time: times[i], estimated: averageDuration(routineId, a.id) == null }));
}

/* ---------------------------------------------------------------------- */
/* Módulo 3 — Ciclos de sueño                                              */
/* ---------------------------------------------------------------------- */

const CYCLE_MIN = 90;
const FALL_ASLEEP_MIN = 15;

// Modo A: tengo una hora fija para despertar -> calcular horas para dormir
function sleepTimesForWake(wakeDate){
  const options = [];
  for (const cycles of [6,5,4,3]){
    const totalMin = cycles*CYCLE_MIN + FALL_ASLEEP_MIN;
    const t = new Date(wakeDate.getTime() - totalMin*60000);
    options.push({ cycles, time: t, recommended: cycles === 5 });
  }
  return options;
}

// Modo B: voy a dormir ahora -> calcular horas para la alarma
function wakeTimesForSleepNow(sleepDate){
  const options = [];
  for (const cycles of [6,5,4,3]){
    const t = new Date(sleepDate.getTime() + (cycles*CYCLE_MIN + FALL_ASLEEP_MIN)*60000);
    options.push({ cycles, time: t, recommended: cycles === 5 });
  }
  return options;
}

// Ciclos completos aún alcanzables si me duermo ahora mismo, dada una hora
// objetivo de despertar.
function cyclesAvailableNow(wakeDate, now = new Date()){
  const minutesLeft = (wakeDate - now)/60000 - FALL_ASLEEP_MIN;
  return Math.floor(minutesLeft / CYCLE_MIN);
}

// Hora exacta en la que se perdió la posibilidad de completar N ciclos.
function thresholdTimeForCycles(wakeDate, cycles){
  return new Date(wakeDate.getTime() - (cycles*CYCLE_MIN + FALL_ASLEEP_MIN)*60000);
}

/* ---------------------------------------------------------------------- */
/* RENDER — navegación                                                     */
/* ---------------------------------------------------------------------- */

const views = ['home','routines','sleep','notes','summary'];
let currentView = 'home';
let sleepMode = 'A'; // 'A' = hora fija de despertar, 'B' = dormir ahora
let nightTickHandle = null;

function switchView(name){
  currentView = name;
  views.forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('active', v === name);
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
  renderCurrentView();
}

function renderCurrentView(){
  if (currentView === 'home') renderHome();
  else if (currentView === 'routines') renderRoutines();
  else if (currentView === 'sleep') renderSleep();
  else if (currentView === 'notes') renderNotes();
  else if (currentView === 'summary') renderSummary();
}

/* ---------------------------------------------------------------------- */
/* RENDER — Inicio                                                         */
/* ---------------------------------------------------------------------- */

function renderHome(){
  const el = document.getElementById('home-content');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  if (!state.routines.length){
    el.innerHTML = `
      <div class="greeting-card">
        <div class="greeting-eyebrow">${greet}</div>
        <div class="greeting-title">Aún no tienes rutinas</div>
        <p class="greeting-sub">Crea tu primera rutina para empezar a registrar tu día con un solo toque.</p>
      </div>
      <div class="empty-state">
        <span class="big-emoji">✨</span>
        Ve a la pestaña <strong>Rutinas</strong> y crea la tuya.
      </div>`;
    return;
  }

  const session = getTodaySession();

  if (!session || session.completed){
    // Elegir / reiniciar rutina del día
    const cards = state.routines.map(r => `
      <button class="card" style="text-align:left; width:100%; cursor:pointer;" data-start="${r.id}">
        <div class="card-row">
          <div>
            <div class="card-title">${escapeHtml(r.name)}</div>
            <div class="card-sub">${r.activities.length} pasos</div>
          </div>
          <span class="badge">Iniciar →</span>
        </div>
      </button>`).join('');

    el.innerHTML = `
      <div class="greeting-card">
        <div class="greeting-eyebrow">${greet}</div>
        <div class="greeting-title">${session && session.completed ? 'Rutina completada 🎉' : '¿Qué rutina toca ahora?'}</div>
        <p class="greeting-sub">${session && session.completed ? 'Puedes ver el detalle en Resumen, o iniciar otra rutina.' : 'Toca una para empezar a registrar tu día.'}</p>
      </div>
      <div class="stack">${cards}</div>

      <div class="card" style="margin-top:14px;">
        <div class="card-title" style="margin-bottom:4px;">🎯 Objetivo de llegada</div>
        <p class="card-sub" style="margin-bottom:10px;">Dinos a qué hora quieres completar el último paso y calculamos hacia atrás la hora ideal para cada actividad, incluida la de despertar.</p>
        <div style="display:flex; gap:8px;">
          <input type="time" id="goal-time-input" class="text-input" value="${defaultTimeValue(6,50)}">
          <button class="btn-secondary small" id="btn-calc-goal">Calcular</button>
        </div>
        <div id="goal-plan" class="stack" style="margin-top:12px;"></div>
      </div>
    `;

    el.querySelectorAll('[data-start]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        startSession(btn.dataset.start);
        renderHome();
      });
    });

    const calcGoalBtn = document.getElementById('btn-calc-goal');
    if (calcGoalBtn) calcGoalBtn.addEventListener('click', ()=>{
      const val = document.getElementById('goal-time-input').value;
      if (!val) return;
      const [h,m] = val.split(':').map(Number);
      const target = new Date();
      target.setHours(h,m,0,0);
      if (target < new Date()) target.setDate(target.getDate()+1);

      const routine = activeRoutine();
      if (!routine){ toast('Selecciona una rutina activa primero'); return; }
      const plan = computeBackwardPlan(routine.id, target);
      document.getElementById('goal-plan').innerHTML = plan.map((p,i)=>`
        <div class="stat-row">
          <span>${i===0?'⏰ ':''}${escapeHtml(p.activity.name)}</span>
          <span class="stat-val">${fmtTimeShort(p.time)}${p.estimated?' *':''}</span>
        </div>
      `).join('') + `<div class="card-sub" style="margin-top:4px;">* aún sin datos suficientes — usamos una estimación inicial de 8 min que se irá afinando con tu uso.</div>`;
    });
    return;
  }

  // Sesión activa: mostrar únicamente el siguiente paso
  const routine = getRoutine(session.routineId);
  const nextIndex = session.logs.length;
  const nextActivity = routine.activities[nextIndex];

  const timelineHtml = session.logs.map((log,i)=>{
    const act = routine.activities.find(a=>a.id===log.activityId);
    const dur = i>0 ? new Date(log.time) - new Date(session.logs[i-1].time) : null;
    return `
      <div class="timeline-item">
        <span class="timeline-dot"></span>
        <span class="timeline-name">${escapeHtml(act ? act.name : '—')}</span>
        ${dur!=null ? `<span class="timeline-dur">${fmtDuration(dur)}</span>` : ''}
        <span class="timeline-time">${fmtTime(log.time)}</span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="greeting-card">
      <div class="greeting-eyebrow">${greet}</div>
      <div class="greeting-title">${escapeHtml(routine.name)}</div>
      <p class="greeting-sub">Paso ${nextIndex+1} de ${routine.activities.length}</p>
    </div>

    <div class="next-step-card">
      <div class="next-step-label">Siguiente paso</div>
      <div class="next-step-name">${escapeHtml(nextActivity.name)}</div>
      <button class="tap-btn done-btn" id="btn-log-next">✔ ${escapeHtml(nextActivity.name)}</button>
    </div>

    ${session.logs.length ? `<div class="card"><div class="card-title" style="margin-bottom:6px;">Recorrido de hoy</div><div class="timeline">${timelineHtml}</div></div>` : ''}

    <div class="mini-btn-row">
      <button class="pill-btn" id="btn-cancel-session">Cancelar sesión</button>
    </div>
  `;

  document.getElementById('btn-log-next').addEventListener('click', ()=>{
    const act = logNextActivity();
    if (act) toast(`✔ ${act.name} — ${fmtTimeShort(new Date())}`);
    renderHome();
    if (getTodaySession() && getTodaySession().completed){
      toast('Rutina completada. Mira tu resumen 🎉', 3000);
    }
  });
  document.getElementById('btn-cancel-session').addEventListener('click', ()=>{
    state.sessions = state.sessions.filter(s => s.id !== session.id);
    state.todaySessionId = null;
    saveState();
    renderHome();
  });
}

/* ---------------------------------------------------------------------- */
/* RENDER — Rutinas                                                        */
/* ---------------------------------------------------------------------- */

let editingRoutineId = null;

function renderRoutines(){
  const list = document.getElementById('routines-list');
  list.innerHTML = state.routines.map(r => `
    <div class="card">
      <div class="card-row">
        <div>
          <div class="card-title">${escapeHtml(r.name)} ${r.id===state.activeRoutineId ? '<span class="badge active">Activa</span>' : ''}</div>
          <div class="card-sub">${r.activities.length} actividades</div>
        </div>
        <div class="row-actions">
          <button class="text-btn" data-edit="${r.id}">Editar</button>
          <button class="text-btn danger" data-del="${r.id}">Eliminar</button>
        </div>
      </div>
    </div>
  `).join('') || `<div class="empty-state"><span class="big-emoji">🗒️</span>Crea tu primera rutina.</div>`;

  list.querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click', ()=> openEditor(b.dataset.edit)));
  list.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', ()=>{
    if (confirm('¿Eliminar esta rutina y su historial de tiempos?')){
      deleteRoutine(b.dataset.del);
      if (editingRoutineId === b.dataset.del) closeEditor();
      renderRoutines();
    }
  }));

  if (editingRoutineId) renderEditor();
}

function openEditor(id){
  editingRoutineId = id;
  document.getElementById('routine-editor').classList.remove('hidden');
  renderEditor();
}
function closeEditor(){
  editingRoutineId = null;
  document.getElementById('routine-editor').classList.add('hidden');
}

function renderEditor(){
  const r = getRoutine(editingRoutineId);
  if (!r) { closeEditor(); return; }
  document.getElementById('routine-name-input').value = r.name;

  const list = document.getElementById('activities-list');
  list.innerHTML = r.activities.map((a,i)=>`
    <div class="activity-item">
      <span class="activity-drag">${i+1}</span>
      <span class="name">${escapeHtml(a.name)}</span>
      <button class="small-icon-btn" data-up="${a.id}" ${i===0?'disabled':''}>↑</button>
      <button class="small-icon-btn" data-down="${a.id}" ${i===r.activities.length-1?'disabled':''}>↓</button>
      <button class="small-icon-btn" data-rm="${a.id}">✕</button>
    </div>
  `).join('') || `<p class="hint">Aún no hay actividades. Agrega la primera abajo.</p>`;

  list.querySelectorAll('[data-up]').forEach(b=>b.addEventListener('click', ()=>{ moveActivity(r.id,b.dataset.up,-1); renderEditor(); }));
  list.querySelectorAll('[data-down]').forEach(b=>b.addEventListener('click', ()=>{ moveActivity(r.id,b.dataset.down,1); renderEditor(); }));
  list.querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click', ()=>{ removeActivity(r.id,b.dataset.rm); renderEditor(); }));

  document.getElementById('btn-set-active-routine').textContent =
    r.id === state.activeRoutineId ? 'Rutina activa ✓' : 'Usar esta rutina';
}

/* ---------------------------------------------------------------------- */
/* RENDER — Sueño                                                          */
/* ---------------------------------------------------------------------- */

function renderSleep(){
  const el = document.getElementById('sleep-content');
  const active = state.sleepSessions.find(s => s.id === state.activeSleepSessionId);

  let html = `
    <div class="mode-toggle">
      <button id="mode-a" class="${sleepMode==='A'?'active':''}">Tengo hora de despertar</button>
      <button id="mode-b" class="${sleepMode==='B'?'active':''}">Voy a dormir ahora</button>
    </div>
  `;

  if (active && active.status === 'sleeping'){
    const wakeDate = new Date(active.targetWake);
    const cyclesLeft = cyclesAvailableNow(wakeDate);
    let subtitle;
    if (cyclesLeft >= 1){
      subtitle = `Si te duermes ahora, alcanzas ${cyclesLeft} ciclo${cyclesLeft===1?'':'s'} completo${cyclesLeft===1?'':'s'}.`;
    } else {
      const lastGood = thresholdTimeForCycles(wakeDate, 1);
      subtitle = `Ya no alcanzas un ciclo completo (se cerró a las ${fmtTimeShort(lastGood)}).`;
    }
    html += `
      <div class="night-indicator" id="night-indicator">
        <div class="small">Despertar objetivo: ${fmtTimeShort(wakeDate)}</div>
        <div class="big" id="night-cycles">${cyclesLeft >= 0 ? cyclesLeft : 0} ciclos</div>
        <div class="small" id="night-sub">${subtitle}</div>
      </div>
      <button class="tap-btn" id="btn-log-wake" style="margin-top:14px;">✔ Desperté</button>
      <button class="pill-btn" id="btn-cancel-night" style="margin-top:10px; width:100%;">Cancelar seguimiento</button>
    `;
  } else {
    if (sleepMode === 'A'){
      html += `
        <div class="card">
          <div class="card-title" style="margin-bottom:10px;">¿A qué hora necesitas despertar?</div>
          <input type="time" id="wake-time-input" class="text-input" value="${defaultTimeValue(7,0)}">
          <button class="btn-primary full" id="btn-calc-sleep">Calcular horas para dormir</button>
        </div>
        <div id="sleep-options" class="stack"></div>
      `;
    } else {
      html += `
        <div class="card">
          <div class="card-title" style="margin-bottom:6px;">Te vas a dormir ahora</div>
          <p class="hint" style="margin:0 0 10px;">Calculamos tu alarma sumando 15 min para conciliar el sueño más ciclos de 90 min.</p>
          <button class="btn-primary full" id="btn-sleep-now">🛌 Dormir ahora (${fmtTimeShort(new Date())})</button>
        </div>
        <div id="wake-options" class="stack"></div>
      `;
    }
  }

  // Historial reciente / aprendizaje
  const past = state.sleepSessions.filter(s => s.status === 'done').slice(-7).reverse();
  if (past.length){
    const avgCycles = (past.reduce((a,s)=>a+(s.cyclesActual||0),0)/past.length).toFixed(1);
    html += `
      <div class="card">
        <div class="card-title" style="margin-bottom:8px;">Lo que hemos aprendido</div>
        <div class="stat-row"><span>Promedio de ciclos (últimas ${past.length} noches)</span><span class="stat-val">${avgCycles}</span></div>
        ${past.map(s => `
          <div class="stat-row">
            <span>${new Date(s.wakeTime || s.targetWake).toLocaleDateString('es-GT',{weekday:'short', day:'numeric', month:'short'})}</span>
            <span class="stat-val">${s.cyclesActual ?? '—'} ciclos${s.energy ? ' · ' + '⭐'.repeat(s.energy) : ''}</span>
          </div>`).join('')}
      </div>
    `;
  }

  el.innerHTML = html;
  wireSleepEvents();
}

function defaultTimeValue(h,m){
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function wireSleepEvents(){
  const a = document.getElementById('mode-a');
  const b = document.getElementById('mode-b');
  if (a) a.addEventListener('click', ()=>{ sleepMode='A'; renderSleep(); });
  if (b) b.addEventListener('click', ()=>{ sleepMode='B'; renderSleep(); });

  const calcBtn = document.getElementById('btn-calc-sleep');
  if (calcBtn) calcBtn.addEventListener('click', ()=>{
    const val = document.getElementById('wake-time-input').value;
    if (!val) return;
    const [h,m] = val.split(':').map(Number);
    const wake = new Date();
    wake.setHours(h, m, 0, 0);
    if (wake < new Date()) wake.setDate(wake.getDate()+1); // asumir mañana si ya pasó

    const options = sleepTimesForWake(wake);
    document.getElementById('sleep-options').innerHTML = options.map(o => `
      <div class="cycle-option ${o.recommended?'recommended':''}">
        <div>
          <div class="cycle-time">${fmtTimeShort(o.time)}</div>
          <div class="cycle-meta">${o.cycles} ciclos completos</div>
        </div>
        ${o.recommended ? '<span class="cycle-star">⭐</span>' : ''}
      </div>
    `).join('') + `<button class="btn-secondary full" id="btn-start-tracking" style="margin-top:6px; width:100%;">Seguir esta noche en vivo</button>`;

    document.getElementById('btn-start-tracking').addEventListener('click', ()=>{
      const session = { id: uid(), mode:'A', targetWake: wake.toISOString(), status:'sleeping', cyclesPlanned:5 };
      state.sleepSessions.push(session);
      state.activeSleepSessionId = session.id;
      saveState();
      renderSleep();
      startNightTicker();
      toast('Seguimiento nocturno activado');
    });
  });

  const sleepNowBtn = document.getElementById('btn-sleep-now');
  if (sleepNowBtn) sleepNowBtn.addEventListener('click', ()=>{
    const now = new Date();
    const options = wakeTimesForSleepNow(now);
    document.getElementById('wake-options').innerHTML = options.map(o => `
      <div class="cycle-option ${o.recommended?'recommended':''}" data-pick="${o.cycles}">
        <div>
          <div class="cycle-time">${fmtTimeShort(o.time)}</div>
          <div class="cycle-meta">${o.cycles} ciclos completos</div>
        </div>
        ${o.recommended ? '<span class="cycle-star">⭐</span>' : ''}
      </div>
    `).join('') + `<p class="hint">Toca la hora que quieras usar como alarma para empezar el seguimiento.</p>`;

    document.querySelectorAll('[data-pick]').forEach(elm => elm.addEventListener('click', ()=>{
      const cycles = Number(elm.dataset.pick);
      const wake = new Date(now.getTime() + (cycles*CYCLE_MIN + FALL_ASLEEP_MIN)*60000);
      const session = { id: uid(), mode:'B', targetWake: wake.toISOString(), sleepTime: now.toISOString(), status:'sleeping', cyclesPlanned: cycles };
      state.sleepSessions.push(session);
      state.activeSleepSessionId = session.id;
      saveState();
      renderSleep();
      startNightTicker();
      toast(`Alarma sugerida: ${fmtTimeShort(wake)}`);
    }));
  });

  const wakeBtn = document.getElementById('btn-log-wake');
  if (wakeBtn) wakeBtn.addEventListener('click', ()=>{
    const s = state.sleepSessions.find(x=>x.id===state.activeSleepSessionId);
    if (!s) return;
    const now = new Date();
    s.wakeTime = now.toISOString();
    if (!s.sleepTime){
      // Modo A: estimamos la hora real de dormir como "ahora - tiempo objetivo dormido"
      s.sleepTime = new Date(now.getTime()).toISOString();
    }
    const start = new Date(s.sleepTime || s.targetWake);
    const slept = (now - new Date(s.sleepTime)) ;
    s.cyclesActual = Math.max(0, Math.round(((now - new Date(s.sleepTime||now)) - FALL_ASLEEP_MIN*60000) / (CYCLE_MIN*60000)));
    s.status = 'done';
    state.activeSleepSessionId = null;
    stopNightTicker();
    saveState();
    askEnergyLevel(s);
  });

  const cancelBtn = document.getElementById('btn-cancel-night');
  if (cancelBtn) cancelBtn.addEventListener('click', ()=>{
    state.sleepSessions = state.sleepSessions.filter(s=>s.id!==state.activeSleepSessionId);
    state.activeSleepSessionId = null;
    stopNightTicker();
    saveState();
    renderSleep();
  });

  if (getActiveSleep()) startNightTicker();
}

function getActiveSleep(){
  return state.sleepSessions.find(s => s.id === state.activeSleepSessionId);
}

function askEnergyLevel(session){
  const levels = [1,2,3,4,5];
  const wrap = document.getElementById('sleep-content');
  wrap.innerHTML = `
    <div class="card" style="text-align:center;">
      <div class="card-title" style="margin-bottom:10px;">¿Cómo te sientes al despertar?</div>
      <div class="mini-btn-row">
        ${levels.map(l=>`<button class="pill-btn" data-lvl="${l}">${'⭐'.repeat(l)}</button>`).join('')}
      </div>
      <button class="text-btn" id="skip-energy" style="margin-top:10px;">Omitir</button>
    </div>`;
  wrap.querySelectorAll('[data-lvl]').forEach(b=>b.addEventListener('click', ()=>{
    session.energy = Number(b.dataset.lvl);
    saveState();
    toast('Registrado. ¡Buen día!');
    renderSleep();
  }));
  document.getElementById('skip-energy').addEventListener('click', ()=>{ renderSleep(); });
}

function startNightTicker(){
  stopNightTicker();
  nightTickHandle = setInterval(()=>{
    const s = getActiveSleep();
    if (!s || currentView !== 'sleep') return;
    const wakeDate = new Date(s.targetWake);
    const cyclesLeft = cyclesAvailableNow(wakeDate);
    const cyclesEl = document.getElementById('night-cycles');
    const subEl = document.getElementById('night-sub');
    if (!cyclesEl) return;
    cyclesEl.textContent = `${cyclesLeft >= 0 ? cyclesLeft : 0} ciclos`;
    if (cyclesLeft >= 1){
      subEl.textContent = `Si te duermes ahora, alcanzas ${cyclesLeft} ciclo${cyclesLeft===1?'':'s'} completo${cyclesLeft===1?'':'s'}.`;
    } else {
      const lastGood = thresholdTimeForCycles(wakeDate, 1);
      subEl.textContent = `Ya no alcanzas un ciclo completo (se cerró a las ${fmtTimeShort(lastGood)}).`;
    }
  }, 30000);
}
function stopNightTicker(){
  if (nightTickHandle) clearInterval(nightTickHandle);
  nightTickHandle = null;
}

/* ---------------------------------------------------------------------- */
/* RENDER — Notas ("Lo veo mañana")                                        */
/* ---------------------------------------------------------------------- */

function renderNotes(){
  const list = document.getElementById('notes-list');
  const notes = [...state.notes].reverse();
  list.innerHTML = notes.map(n => `
    <div class="card">
      <div class="card-row">
        <div class="card-title" style="text-decoration:${n.done?'line-through':'none'}; color:${n.done?'var(--text-faint)':'var(--deep-twilight)'}; font-weight:600;">
          ${escapeHtml(n.text)}
        </div>
        <div class="row-actions">
          <button class="text-btn" data-toggle="${n.id}">${n.done?'Reabrir':'Listo'}</button>
          <button class="text-btn danger" data-del="${n.id}">✕</button>
        </div>
      </div>
    </div>
  `).join('') || `<div class="empty-state"><span class="big-emoji">🌙</span>Sin pendientes. Mente libre para dormir.</div>`;

  list.querySelectorAll('[data-toggle]').forEach(b=>b.addEventListener('click', ()=>{
    const n = state.notes.find(x=>x.id===b.dataset.toggle);
    n.done = !n.done; saveState(); renderNotes();
  }));
  list.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>{
    state.notes = state.notes.filter(x=>x.id!==b.dataset.del);
    saveState(); renderNotes();
  }));
}

/* ---------------------------------------------------------------------- */
/* RENDER — Resumen                                                        */
/* ---------------------------------------------------------------------- */

function renderSummary(){
  const el = document.getElementById('summary-content');
  const todaySession = state.sessions.find(s => s.date === todayKey());
  let html = '';

  if (todaySession && todaySession.logs.length){
    const routine = getRoutine(todaySession.routineId);
    const rows = todaySession.logs.map((log,i)=>{
      const act = routine.activities.find(a=>a.id===log.activityId);
      const dur = i>0 ? new Date(log.time) - new Date(todaySession.logs[i-1].time) : null;
      const avg = i>0 ? averageDuration(routine.id, act.id) : null;
      let compareTxt = '';
      if (dur!=null && avg!=null){
        const diff = dur-avg;
        compareTxt = Math.abs(diff) < 60000 ? ' · igual al promedio' :
          diff>0 ? ` · ${fmtDuration(Math.abs(diff))} más lento` : ` · ${fmtDuration(Math.abs(diff))} más rápido`;
      }
      return `<div class="stat-row"><span>${escapeHtml(act ? act.name : '—')}</span><span class="stat-val">${dur!=null ? fmtDuration(dur) : '—'}</span></div>${compareTxt ? `<div class="card-sub" style="margin:-4px 0 4px;">${compareTxt}</div>`:''}`;
    }).join('');

    const totalMs = todaySession.logs.length>1
      ? new Date(todaySession.logs.at(-1).time) - new Date(todaySession.logs[0].time)
      : null;

    html += `
      <div class="card">
        <div class="card-title" style="margin-bottom:8px;">Hoy — ${escapeHtml(routine.name)}</div>
        ${rows}
        ${totalMs!=null ? `<div class="stat-row" style="border-top:1px solid var(--border); margin-top:6px; padding-top:10px;"><span><strong>Tiempo total</strong></span><span class="stat-val">${fmtDuration(totalMs)}</span></div>` : ''}
      </div>`;
  } else {
    html += `<div class="empty-state"><span class="big-emoji">📊</span>Aún no registras nada hoy. Ve a Inicio y empieza tu rutina.</div>`;
  }

  // Promedios globales por rutina activa
  const routine = activeRoutine();
  if (routine && routine.activities.length){
    const avgRows = routine.activities.map((a,i)=>{
      if (i===0) return '';
      const avg = averageDuration(routine.id, a.id);
      return `<div class="stat-row"><span>${escapeHtml(a.name)}</span><span class="stat-val">${avg!=null ? fmtDuration(avg) : 'Sin datos aún'}</span></div>`;
    }).join('');
    html += `<div class="card"><div class="card-title" style="margin-bottom:8px;">Tus promedios — ${escapeHtml(routine.name)}</div>${avgRows}</div>`;
  }

  // Patrones simples por día de la semana (tiempo total de preparación)
  const completed = state.sessions.filter(s => s.completed && s.logs.length>1);
  if (completed.length >= 3){
    const byDay = {};
    completed.forEach(s=>{
      const d = new Date(s.logs[0].time);
      const day = weekdayName(d);
      const total = new Date(s.logs.at(-1).time) - new Date(s.logs[0].time);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(total);
    });
    const overallAvg = completed.reduce((acc,s)=> acc + (new Date(s.logs.at(-1).time)-new Date(s.logs[0].time)), 0) / completed.length;
    const insights = Object.entries(byDay).map(([day, arr])=>{
      const avg = arr.reduce((a,b)=>a+b,0)/arr.length;
      const diff = avg - overallAvg;
      if (Math.abs(diff) < 3*60000) return null;
      return `Los ${day} sueles tardar ${fmtDuration(Math.abs(diff))} ${diff>0?'más':'menos'} de lo habitual.`;
    }).filter(Boolean);

    if (insights.length){
      html += `<div class="card"><div class="card-title" style="margin-bottom:8px;">Patrones detectados</div>
        <div class="stack">${insights.map(t=>`<div class="insight">💡 ${t}</div>`).join('')}</div>
      </div>`;
    }
  }

  // Resumen de sueño
  const lastSleep = [...state.sleepSessions].reverse().find(s=>s.status==='done');
  if (lastSleep){
    html += `
      <div class="card">
        <div class="card-title" style="margin-bottom:8px;">Última noche</div>
        <div class="stat-row"><span>Dormiste</span><span class="stat-val">${fmtTimeShort(new Date(lastSleep.sleepTime))}</span></div>
        <div class="stat-row"><span>Despertaste</span><span class="stat-val">${fmtTimeShort(new Date(lastSleep.wakeTime))}</span></div>
        <div class="stat-row"><span>Ciclos completos</span><span class="stat-val">${lastSleep.cyclesActual ?? '—'}</span></div>
        ${lastSleep.energy ? `<div class="stat-row"><span>Energía al despertar</span><span class="stat-val">${'⭐'.repeat(lastSleep.energy)}</span></div>` : ''}
      </div>`;
  }

  el.innerHTML = html;
}

/* ---------------------------------------------------------------------- */
/* Objetivo de llegada — modal simple integrado en Rutinas                 */
/* ---------------------------------------------------------------------- */
// (Disponible desde la tarjeta de rutina activa en Inicio, vía prompt rápido)

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/* ---------------------------------------------------------------------- */
/* Wiring general                                                          */
/* ---------------------------------------------------------------------- */

document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> switchView(btn.dataset.view));
});

document.getElementById('btn-new-routine').addEventListener('click', ()=>{
  const r = createRoutine('Nueva rutina');
  renderRoutines();
  openEditor(r.id);
});
document.getElementById('btn-close-editor').addEventListener('click', closeEditor);
document.getElementById('routine-name-input').addEventListener('input', (e)=>{
  const r = getRoutine(editingRoutineId);
  if (r){ r.name = e.target.value; saveState(); renderRoutines(); }
});
document.getElementById('btn-add-activity').addEventListener('click', ()=>{
  const input = document.getElementById('new-activity-input');
  if (!input.value.trim()) return;
  addActivity(editingRoutineId, input.value);
  input.value = '';
  renderEditor();
});
document.getElementById('new-activity-input').addEventListener('keydown', (e)=>{
  if (e.key === 'Enter') document.getElementById('btn-add-activity').click();
});
document.getElementById('btn-set-active-routine').addEventListener('click', ()=>{
  state.activeRoutineId = editingRoutineId;
  saveState();
  renderRoutines();
  toast('Rutina activa actualizada');
});

document.getElementById('btn-add-note').addEventListener('click', ()=>{
  const input = document.getElementById('new-note-input');
  if (!input.value.trim()) return;
  state.notes.push({ id: uid(), text: input.value.trim(), date: todayKey(), done:false });
  input.value = '';
  saveState();
  renderNotes();
});
document.getElementById('new-note-input').addEventListener('keydown', (e)=>{
  if (e.key === 'Enter') document.getElementById('btn-add-note').click();
});

document.getElementById('btn-night-toggle').addEventListener('click', ()=>{
  switchView('sleep');
});

/* ---------------------------------------------------------------------- */
/* Service worker (PWA offline)                                            */
/* ---------------------------------------------------------------------- */
if ('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{ /* silencioso */ });
  });
}

/* ---------------------------------------------------------------------- */
/* Arranque                                                                 */
/* ---------------------------------------------------------------------- */
switchView('home');
if (getActiveSleep()) startNightTicker();
