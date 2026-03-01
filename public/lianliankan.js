const FRUITS = ['🍎','🍊','🍋','🍇','🍉','🍓','🍑','🍒','🥝','🍌','🍍','🫐','🥭','🍈'];
const ROWS = 8, COLS = 10;
let grid = [], selected = null, score = 0, remaining = 0, timerVal = 0, timerRef = null;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.random() * (i + 1) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function initGame() {
  clearInterval(timerRef);
  score = 0; timerVal = 0;
  document.getElementById('score').textContent = 0;
  document.getElementById('timer').textContent = 0;
  document.getElementById('winMsg').textContent = '';
  const inner = (ROWS - 2) * (COLS - 2);
  let pool = [];
  for (let i = 0; i < inner / 2; i++) pool.push(FRUITS[i % FRUITS.length], FRUITS[i % FRUITS.length]);
  shuffle(pool);
  grid = Array.from({length: ROWS}, () => Array(COLS).fill(null));
  let idx = 0;
  for (let r = 1; r < ROWS - 1; r++)
    for (let c = 1; c < COLS - 1; c++) grid[r][c] = pool[idx++];
  remaining = pool.length;
  document.getElementById('remaining').textContent = remaining;
  selected = null;
  render();
  timerRef = setInterval(() => { timerVal++; document.getElementById('timer').textContent = timerVal; }, 1000);
}

function getCell(r, c) { return document.querySelector(`#board .cell[data-r="${r}"][data-c="${c}"]`); }

function render() {
  const board = document.getElementById('board');
  board.style.gridTemplateColumns = `repeat(${COLS}, 56px)`;
  board.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const div = document.createElement('div');
      div.className = 'cell' + (grid[r][c] ? '' : ' empty');
      div.textContent = grid[r][c] || '';
      div.dataset.r = r; div.dataset.c = c;
      if (grid[r][c]) div.addEventListener('click', () => onCellClick(r, c, div));
      board.appendChild(div);
    }
  }
}

function onCellClick(r, c, div) {
  if (!grid[r][c]) return;
  if (selected && selected.r === r && selected.c === c) { div.classList.remove('selected'); selected = null; return; }
  if (!selected) { selected = {r, c}; div.classList.add('selected'); return; }
  const prev = selected;
  const path = findPath(prev.r, prev.c, r, c);
  if (grid[prev.r][prev.c] === grid[r][c] && path) {
    drawPath(path);
    const prevCell = getCell(prev.r, prev.c);
    setTimeout(() => {
      grid[prev.r][prev.c] = null; grid[r][c] = null;
      if (prevCell) { prevCell.classList.add('matched'); prevCell.classList.remove('selected'); }
      div.classList.add('matched');
      remaining -= 2; score += 10;
      document.getElementById('remaining').textContent = remaining;
      document.getElementById('score').textContent = score;
      const cv = document.getElementById('pathCanvas'); if (cv) cv.remove();
      if (remaining === 0) {
        clearInterval(timerRef);
        document.getElementById('winMsg').innerHTML = `<span class="win">🎉 恭喜通关！用时 ${timerVal} 秒，得分 ${score}</span>`;
      }
    }, 350);
    selected = null;
  } else {
    const prevCell = getCell(prev.r, prev.c);
    if (prevCell) prevCell.classList.remove('selected');
    selected = {r, c}; div.classList.add('selected');
  }
}

function lineOpen(r1, c1, r2, c2) {
  if (r1 === r2) { const [a,b] = c1<c2?[c1,c2]:[c2,c1]; for (let c=a+1;c<b;c++) if(grid[r1][c]) return false; return true; }
  if (c1 === c2) { const [a,b] = r1<r2?[r1,r2]:[r2,r1]; for (let r=a+1;r<b;r++) if(grid[r][c1]) return false; return true; }
  return false;
}

function findPath(r1, c1, r2, c2) {
  // direct
  if ((r1===r2||c1===c2) && lineOpen(r1,c1,r2,c2)) return [[r1,c1],[r2,c2]];
  // 1 corner
  if (!grid[r1][c2] && lineOpen(r1,c1,r1,c2) && lineOpen(r1,c2,r2,c2)) return [[r1,c1],[r1,c2],[r2,c2]];
  if (!grid[r2][c1] && lineOpen(r1,c1,r2,c1) && lineOpen(r2,c1,r2,c2)) return [[r1,c1],[r2,c1],[r2,c2]];
  // 2 corners
  for (let c=0;c<COLS;c++) { if(c===c1||c===c2) continue; if(!grid[r1][c]&&!grid[r2][c]&&lineOpen(r1,c1,r1,c)&&lineOpen(r1,c,r2,c)&&lineOpen(r2,c,r2,c2)) return [[r1,c1],[r1,c],[r2,c],[r2,c2]]; }
  for (let r=0;r<ROWS;r++) { if(r===r1||r===r2) continue; if(!grid[r][c1]&&!grid[r][c2]&&lineOpen(r1,c1,r,c1)&&lineOpen(r,c1,r,c2)&&lineOpen(r,c2,r2,c2)) return [[r1,c1],[r,c1],[r,c2],[r2,c2]]; }
  return null;
}

function drawPath(path) {
  const board = document.getElementById('board');
  let cv = document.getElementById('pathCanvas'); if (cv) cv.remove();
  cv = document.createElement('canvas'); cv.id = 'pathCanvas';
  cv.width = board.offsetWidth; cv.height = board.offsetHeight;
  board.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.beginPath();
  const cellW = 60, cellH = 60;
  for (let i = 0; i < path.length; i++) {
    const x = path[i][1]*cellW+28, y = path[i][0]*cellH+28;
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  ctx.stroke();
}

function hintOnce() {
  for (let r1=0;r1<ROWS;r1++) for (let c1=0;c1<COLS;c1++) {
    if (!grid[r1][c1]) continue;
    for (let r2=r1;r2<ROWS;r2++) for (let c2=(r2===r1?c1+1:0);c2<COLS;c2++) {
      if (!grid[r2][c2]||grid[r1][c1]!==grid[r2][c2]) continue;
      if (findPath(r1,c1,r2,c2)) {
        const a=getCell(r1,c1),b=getCell(r2,c2);
        if(a)a.style.background='#ffe0b2'; if(b)b.style.background='#ffe0b2';
        setTimeout(()=>{if(a)a.style.background='';if(b)b.style.background='';},1200);
        return;
      }
    }
  }
  alert('没有可消除的配对了，试试重排吧！');
}

function shuffleBoard() {
  let tiles = [];
  for (let r=1;r<ROWS-1;r++) for (let c=1;c<COLS-1;c++) if(grid[r][c]) tiles.push(grid[r][c]);
  shuffle(tiles); let idx=0;
  for (let r=1;r<ROWS-1;r++) for (let c=1;c<COLS-1;c++) if(grid[r][c]) grid[r][c]=tiles[idx++];
  selected=null; render();
}

initGame();
