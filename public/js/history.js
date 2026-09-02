// History: render, delete entry, delete all
function normalizeHistoryEntry(m, i) {
  return {
    id: m.matchId ?? m.id ?? i,
    redName: m.playerRedName ?? m.redName ?? 'Red',
    blueName: m.playerBlueName ?? m.blueName ?? 'Blue',
    redScore: m.scoreRed ?? m.redScore ?? 0,
    blueScore: m.scoreBlue ?? m.blueScore ?? 0,
    winner: m.winner ?? null,
    when: m.endedAt ? new Date(m.endedAt).toLocaleString() : (m.date ?? ''),
  };
}

function renderHistory() {
  const box = document.getElementById('historyList');
  if (!box) return;
  const deleteButton = `<div style="display:flex;justify-content:flex-end;margin-bottom:16px;"><button class="btn danger" onclick="deleteAllMatchHistory()">✕ DELETE HISTORY</button></div>`;
  if (!matchHistory.length) { box.innerHTML = deleteButton + emptyState('No completed matches yet.'); return; }
  box.innerHTML = deleteButton + matchHistory.map((raw, i) => {
    const m = normalizeHistoryEntry(raw, i);
    return `<div class="match-card">
      <div class="side red"><div class="tn">Red</div><div>${m.redName}</div><div class="sc">${String(m.redScore).padStart(2,'0')}</div></div>
      <div class="mid">Match ${m.id}<br>${m.when}<br><span class="winner">${m.winner === 'draw' ? 'Draw' : 'Winner: ' + (m.winner === 'red' ? 'Red' : 'Blue')}</span><br>
        <button class="btn small danger" onclick="deleteHistoryEntry('${raw.matchId}')" style="margin-top:10px;">✕ Delete</button></div>
      <div class="side blue"><div class="tn">Blue</div><div>${m.blueName}</div><div class="sc">${String(m.blueScore).padStart(2,'0')}</div></div>
    </div>`;
  }).join('');
}

function refreshHistoryOnMatchEnd() {
  api.getMatchHistory().then(h => { const entries = Array.isArray(h) ? h : (h?.entries || []); matchHistory = entries; renderHistory(); }).catch(() => {});
}

async function deleteAllMatchHistory() {
  if (!confirm('Are you sure you want to delete ALL match history?')) return;
  try {
    await api.deleteMatchHistory();
    matchHistory = [];
    renderHistory();
    alert('Match history deleted successfully.');
  } catch (error) {
    console.error('[history] delete failed:', error);
    alert('Failed to delete match history. Check the server.');
  }
}

async function deleteHistoryEntry(matchId) {
  if (!confirm('Are you sure you want to delete this match history?')) return;
  try {
    await api.deleteHistoryEntry(matchId);
    matchHistory = matchHistory.filter(entry => entry.matchId !== matchId);
    renderHistory();
  } catch (error) {
    console.error('[history] individual delete failed:', error);
    alert('Failed to delete this match history.');
  }
}
