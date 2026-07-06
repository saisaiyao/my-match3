// 增强版消消乐原型：支持特殊方块（条纹/炸弹）与本地关卡编辑器
(() => {
  const ROWS = 6, COLS = 6;
  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('score');
  const movesEl = document.getElementById('moves');
  const levelSelect = document.getElementById('level');
  const btnStart = document.getElementById('btn-start');
  const messageEl = document.getElementById('message');
  const hintBtn = document.getElementById('hint');
  const shuffleBtn = document.getElementById('shuffle');
  const muteChk = document.getElementById('mute');
  const btnEditLevel = document.getElementById('btn-edit-level');
  const levelEditor = document.getElementById('level-editor');
  const editorTypes = document.getElementById('editor-types');
  const editorMoves = document.getElementById('editor-moves');
  const editorSave = document.getElementById('editor-save');
  const editorCancel = document.getElementById('editor-cancel');

  // special encoding:
  // 1..16 => normal colors
  // 100 + color => stripe-horizontal
  // 200 + color => stripe-vertical
  // 300 + color => bomb

  let state = {
    grid: [], // numeric codes
    selected: null,
    score: 0,
    moves: 0,
    remainingMoves: 30,
    chain: 0,
    allowedTypes: 8,
    level: 1,
    goal: null
  };

  // Sound using WebAudio
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = AudioCtx ? new AudioCtx() : null;
  function playBeep(freq=880, time=0.05, type='sine'){
    if(!audioCtx || muteChk.checked) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = 0.05;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + time);
  }

  function isSpecial(t){ return t>100; }
  function baseType(t){ return isSpecial(t) ? (t%100) : t; }
  function specialKind(t){ if(!isSpecial(t)) return null; const k = Math.floor(t/100); return k===1? 'stripe-h' : k===2? 'stripe-v' : k===3? 'bomb' : null; }

  function makeCellEl(r,c,typeId){
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.r = r; el.dataset.c = c; el.dataset.type = typeId;
    const img = document.createElement('img');
    img.src = `assets/block-${String(baseType(typeId)).padStart(2,'0')}.svg`;
    img.alt = `type${typeId}`;
    el.appendChild(img);
    if(isSpecial(typeId)){
      const span = document.createElement('span');
      span.className = 'badge';
      span.textContent = specialKind(typeId);
      el.appendChild(span);
    }
    el.addEventListener('pointerdown', onCellPointer);
    return el;
  }

  function initBoard(){
    boardEl.innerHTML = '';
    state.grid = [];
    for(let r=0;r<ROWS;r++){
      const row=[];
      for(let c=0;c<COLS;c++){
        const type = randType();
        row.push(type);
        boardEl.appendChild(makeCellEl(r,c,type));
      }
      state.grid.push(row);
    }
    // ensure no initial matches
    while(true){
      const res = findMatches();
      if(res.cells.length===0) break;
      removeMatchesSilent(res.cells);
      collapse();
      refill();
    }
    render();
  }

  function randType(){
    return Math.floor(Math.random()*state.allowedTypes)+1;
  }

  function render(){
    boardEl.innerHTML = '';
    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        const t = state.grid[r][c];
        boardEl.appendChild(makeCellEl(r,c,t));
      }
    }
    scoreEl.textContent = state.score;
    movesEl.textContent = state.remainingMoves;
  }

  function onCellPointer(e){
    const el = e.currentTarget;
    const r= +el.dataset.r, c= +el.dataset.c;
    if(!state.selected){
      state.selected = {r,c,el};
      el.classList.add('selected');
      playBeep(880,0.04);
    } else {
      const a = state.selected;
      if(a.r===r && a.c===c){ a.el.classList.remove('selected'); state.selected=null; return; }
      if(Math.abs(a.r-r)+Math.abs(a.c-c)===1){
        swapAndResolve(a.r,a.c,r,c);
      } else {
        a.el.classList.remove('selected');
        state.selected = {r,c,el};
        el.classList.add('selected');
      }
    }
  }

  async function swapAndResolve(r1,c1,r2,c2){
    disableInput(true);
    swapGrid(r1,c1,r2,c2);
    render();
    await sleep(160);
    const res = findMatches();
    if(res.cells.length===0){
      swapGrid(r1,c1,r2,c2);
      render();
      state.selected = null;
      playBeep(200,0.06,'sawtooth');
      await sleep(160);
      disableInput(false);
      return;
    }
    state.remainingMoves = Math.max(0,state.remainingMoves-1);
    state.chain = 0;
    while(true){
      const r = findMatches();
      if(r.cells.length===0) break;
      state.chain++;
      handleSpecialCreation(r.sequences);
      removeMatches(r.cells);
      await sleep(200);
      collapse();
      await sleep(140);
      refill();
      await sleep(220);
    }
    state.selected = null;
    render();
    checkGameOver();
    disableInput(false);
  }

  function swapGrid(r1,c1,r2,c2){
    const t = state.grid[r1][c1];
    state.grid[r1][c1] = state.grid[r2][c2];
    state.grid[r2][c2] = t;
  }

  // findMatches returns {cells: [{r,c}], sequences: [{orientation:'row'|'col', r/c, start, end, len, type}]}
  function findMatches(){
    const matches = [];
    const mark = Array.from({length:ROWS},()=>Array(COLS,false));
    const sequences = [];
    // rows
    for(let r=0;r<ROWS;r++){
      let start=0;
      for(let c=1;c<=COLS;c++){
        if(c<COLS && baseType(state.grid[r][c])===baseType(state.grid[r][start])) continue;
        const len = c-start;
        if(len>=3){
          for(let k=start;k<c;k++) mark[r][k]=true;
          sequences.push({orientation:'row', r, start, end:c-1, len, type: baseType(state.grid[r][start])});
        }
        start=c;
      }
    }
    // cols
    for(let c=0;c<COLS;c++){
      let start=0;
      for(let r=1;r<=ROWS;r++){
        if(r<ROWS && baseType(state.grid[r][c])===baseType(state.grid[start][c])) continue;
        const len = r-start;
        if(len>=3){
          for(let k=start;k<r;k++) mark[k][c]=true;
          sequences.push({orientation:'col', c, start, end:r-1, len, type: baseType(state.grid[start][c])});
        }
        start=r;
      }
    }
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(mark[r][c]) matches.push({r,c});
    return {cells: matches, sequences};
  }

  function handleSpecialCreation(sequences){
    // For any sequence len>=4 create special block at the end cell
    for(const s of sequences){
      if(s.len>=5){
        // create bomb at last cell
        if(s.orientation==='row'){
          const r=s.r, c=s.end;
          state.grid[r][c] = 300 + s.type;
        } else {
          const r=s.end, c=s.c;
          state.grid[r][c] = 300 + s.type;
        }
      } else if(s.len===4){
        // stripe: orientation determines kind
        if(s.orientation==='row'){
          const r=s.r, c=s.end;
          state.grid[r][c] = 100 + s.type; // horizontal
        } else {
          const r=s.end, c=s.c;
          state.grid[r][c] = 200 + s.type; // vertical
        }
      }
    }
  }

  function removeMatches(matches){
    // mark dom for animation
    for(const m of matches){
      const selector = `.cell[data-r="${m.r}"][data-c="${m.c}"]`;
      const el = boardEl.querySelector(selector);
      if(el) el.classList.add('matching');
    }
    const count = matches.length;
    const base = 10;
    const chainMul = 1 + 0.5*(state.chain);
    const gained = Math.round(base * count * chainMul);
    state.score += gained;
    playBeep(600 + Math.min(1200, count*30 + state.chain*80), 0.06 + Math.min(0.06, count*0.01));
    // remove cells unless they are special (we leave special blocks in place if created)
    for(const m of matches){
      const cur = state.grid[m.r][m.c];
      if(isSpecial(cur)){
        // trigger special
        triggerSpecial(m.r,m.c,cur);
        state.grid[m.r][m.c]=0;
      } else {
        state.grid[m.r][m.c]=0;
      }
    }
    return matches.length;
  }

  function removeMatchesSilent(matches){
    for(const m of matches) state.grid[m.r][m.c]=0;
  }

  function triggerSpecial(r,c,code){
    const kind = specialKind(code);
    const color = baseType(code);
    if(kind==='stripe-h'){
      // clear row r
      for(let cc=0;cc<COLS;cc++) state.grid[r][cc]=0;
    } else if(kind==='stripe-v'){
      for(let rr=0;rr<ROWS;rr++) state.grid[rr][c]=0;
    } else if(kind==='bomb'){
      // clear 3x3
      for(let rr=Math.max(0,r-1); rr<=Math.min(ROWS-1,r+1); rr++) for(let cc=Math.max(0,c-1); cc<=Math.min(COLS-1,c+1); cc++) state.grid[rr][cc]=0;
    }
    playBeep(1000,0.12,'square');
  }

  function collapse(){
    for(let c=0;c<COLS;c++){
      let write = ROWS-1;
      for(let r=ROWS-1;r>=0;r--){
        if(state.grid[r][c]!==0){
          state.grid[write][c]=state.grid[r][c];
          write--;
        }
      }
      for(let r=write;r>=0;r--) state.grid[r][c]=0;
    }
  }

  function refill(){
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(state.grid[r][c]===0) state.grid[r][c]=randType();
  }

  function disableInput(val){
    boardEl.style.pointerEvents = val ? 'none' : 'auto';
  }

  function sleep(ms){ return new Promise(res=>setTimeout(res,ms)); }

  function checkGameOver(){
    if(state.remainingMoves<=0){
      messageEl.textContent = `步数耗尽！得分 ${state.score}`;
      playBeep(240,0.4,'sine');
    }
  }

  function findHint(){
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
      for(const d of dirs){
        const r2=r+d[0], c2=c+d[1];
        if(r2<0||r2>=ROWS||c2<0||c2>=COLS) continue;
        swapGrid(r,c,r2,c2);
        const m = findMatches();
        swapGrid(r,c,r2,c2);
        if(m.cells.length>0) return {r,c,r2,c2};
      }
    }
    return null;
  }

  function shuffleBoard(){
    const flat = [];
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) flat.push(state.grid[r][c]);
    for(let i=flat.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [flat[i],flat[j]]=[flat[j],flat[i]];
    }
    let idx=0;
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) state.grid[r][c]=flat[idx++];
    if(!findHint()) shuffleBoard();
    render();
  }

  // UI bindings
  btnStart.addEventListener('click', ()=>{ startLevel(+levelSelect.value); });
  hintBtn.addEventListener('click', ()=>{
    const h = findHint();
    if(!h){ messageEl.textContent='没有可用步，准备重洗...'; playBeep(220); return; }
    const sel = boardEl.querySelector(`.cell[data-r="${h.r}"][data-c="${h.c}"]`);
    if(sel){ sel.classList.add('selected'); setTimeout(()=>sel.classList.remove('selected'),700); }
    playBeep(1200,0.05);
  });
  shuffleBtn.addEventListener('click', ()=>{ shuffleBoard(); playBeep(360,0.08); });

  // level editor
  btnEditLevel.addEventListener('click', ()=>{ levelEditor.classList.remove('hidden'); editorTypes.value = state.allowedTypes; editorMoves.value = state.remainingMoves; });
  editorCancel.addEventListener('click', ()=>{ levelEditor.classList.add('hidden'); });
  editorSave.addEventListener('click', ()=>{ const t = Math.max(3, Math.min(16, +editorTypes.value)); const m = Math.max(5, +editorMoves.value); state.allowedTypes = t; state.remainingMoves = m; levelEditor.classList.add('hidden'); startLevelCustom(t,m); });

  function startLevel(lv){
    state.level = lv;
    const config = {1:{types:8,moves:30,goal:null},2:{types:10,moves:25,goal:null},3:{types:12,moves:22,goal:null},4:{types:16,moves:20,goal:null}};
    const cfg = config[lv] || config[1];
    state.allowedTypes = cfg.types; state.remainingMoves = cfg.moves; state.score=0; state.chain=0; state.goal = cfg.goal; messageEl.textContent=''; initBoard();
  }
  function startLevelCustom(types,moves){ state.score=0; state.chain=0; state.allowedTypes=types; state.remainingMoves=moves; state.goal=null; initBoard(); }

  // start default
  startLevel(1);

})();
