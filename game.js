// 简易消消乐原型（6x6 grid），单文件逻辑：swap、match、collapse、refill、score、moves
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

  let state = {
    grid: [], // 2D array of typeId
    selected: null,
    score: 0,
    moves: 0,
    remainingMoves: 30,
    chain: 0,
    allowedTypes: 8,
    level: 1,
    goal: null // optionally {typeId: n}
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

  // Helper: create element for a cell
  function makeCellEl(r,c,typeId){
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.r = r; el.dataset.c = c; el.dataset.type = typeId;
    const img = document.createElement('img');
    img.src = `assets/block-${String(typeId).padStart(2,'0')}.svg`;
    img.alt = `type${typeId}`;
    el.appendChild(img);
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
      const m = findMatches();
      if(m.length===0) break;
      removeMatchesSilent(m);
      collapse();
      refill();
    }
    render();
  }

  function randType(){
    return Math.floor(Math.random()*state.allowedTypes)+1;
  }

  function render(){
    // update dom images and attrs
    for(const el of boardEl.children){
      const r = +el.dataset.r, c= +el.dataset.c;
      const t = state.grid[r][c];
      el.dataset.type = t;
      const img = el.querySelector('img');
      img.src = `assets/block-${String(t).padStart(2,'0')}.svg`;
      el.classList.remove('selected','matching');
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
      // if same cell: deselect
      if(a.r===r && a.c===c){ a.el.classList.remove('selected'); state.selected=null; return; }
      // check adjacency
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
    const matches = findMatches();
    if(matches.length===0){
      // invalid move, swap back
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
      const ms = findMatches();
      if(ms.length===0) break;
      state.chain++;
      const removed = removeMatches(ms);
      await sleep(180);
      collapse();
      await sleep(120);
      refill();
      await sleep(180);
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

  function findMatches(){
    const matches = []; // array of coords {r,c}
    const mark = Array.from({length:ROWS},()=>Array(COLS,false));
    // rows
    for(let r=0;r<ROWS;r++){
      let start=0;
      for(let c=1;c<=COLS;c++){
        if(c<COLS && state.grid[r][c]===state.grid[r][start]) continue;
        const len = c-start;
        if(len>=3){
          for(let k=start;k<c;k++) mark[r][k]=true;
        }
        start=c;
      }
    }
    // cols
    for(let c=0;c<COLS;c++){
      let start=0;
      for(let r=1;r<=ROWS;r++){
        if(r<ROWS && state.grid[r][c]===state.grid[start][c]) continue;
        const len = r-start;
        if(len>=3){
          for(let k=start;k<r;k++) mark[k][c]=true;
        }
        start=r;
      }
    }
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(mark[r][c]) matches.push({r,c});
    return matches;
  }

  function removeMatches(matches){
    // mark dom for animation
    const unique = matches; // array of coords
    for(const m of unique){
      const selector = `.cell[data-r="${m.r}"][data-c="${m.c}"]`;
      const el = boardEl.querySelector(selector);
      if(el) el.classList.add('matching');
    }
    // scoring
    const count = unique.length;
    const base = 10;
    const chainMul = 1 + 0.5*(state.chain);
    const gained = Math.round(base * count * chainMul);
    state.score += gained;
    playBeep(600 + Math.min(1200, count*30 + state.chain*80), 0.06 + Math.min(0.06, count*0.01));
    // remove: set to 0 then collapse
    for(const m of unique) state.grid[m.r][m.c] = 0;
    return unique.length;
  }

  function removeMatchesSilent(matches){
    for(const m of matches) state.grid[m.r][m.c]=0;
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
      // fill upper with zeros
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

  // hint: find any valid swap that leads to a match (brute-force)
  function findHint(){
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
      for(const d of dirs){
        const r2=r+d[0], c2=c+d[1];
        if(r2<0||r2>=ROWS||c2<0||c2>=COLS) continue;
        swapGrid(r,c,r2,c2);
        const m = findMatches();
        swapGrid(r,c,r2,c2);
        if(m.length>0) return {r,c,r2,c2};
      }
    }
    return null;
  }

  // shuffle: randomize until there is at least one move
  function shuffleBoard(){
    // simple Fisher-Yates on flattened
    const flat = [];
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) flat.push(state.grid[r][c]);
    for(let i=flat.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [flat[i],flat[j]]=[flat[j],flat[i]];
    }
    let idx=0;
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) state.grid[r][c]=flat[idx++];
    // ensure no immediate matches left-over; if none possible, reshuffle
    if(!findHint()) shuffleBoard();
    render();
  }

  // UI bindings
  btnStart.addEventListener('click', ()=>{
    const lv = +levelSelect.value;
    startLevel(lv);
  });
  hintBtn.addEventListener('click', ()=>{
    const h = findHint();
    if(!h){ messageEl.textContent='没有可用步，准备重洗...'; playBeep(220); return; }
    const sel = boardEl.querySelector(`.cell[data-r="${h.r}"][data-c="${h.c}"]`);
    sel.classList.add('selected');
    setTimeout(()=>sel.classList.remove('selected'),700);
    playBeep(1200,0.05);
  });
  shuffleBtn.addEventListener('click', ()=>{ shuffleBoard(); playBeep(360,0.08); });

  function startLevel(lv){
    state.level = lv;
    // mapping level -> allowed types & moves
    const config = {
      1:{types:8,moves:30,goal:null},
      2:{types:10,moves:25,goal:null},
      3:{types:12,moves:22,goal:null},
      4:{types:16,moves:20,goal:null}
    };
    const cfg = config[lv] || config[1];
    state.allowedTypes = cfg.types;
    state.remainingMoves = cfg.moves;
    state.score = 0;
    state.chain = 0;
    state.goal = cfg.goal;
    messageEl.textContent = '';
    initBoard();
  }

  // start default
  startLevel(1);

})();
