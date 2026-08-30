// Settings: load from backend, collect form values, save to backend
function collectSettingsPayload() {
  const s = document.getElementById('screen-settings');
  if (!s) return {};
  const nums = [...s.querySelectorAll('input[type="number"]')].map(i => Number(i.value));
  const selects = [...s.querySelectorAll('select')].map(sel => sel.value);
  const toggles = [...s.querySelectorAll('.switch')].map(sw => sw.classList.contains('on'));
  const range = s.querySelector('input[type="range"]');
  return {
    matchDurationMin: nums[0], intenseModeTriggerSec: nums[1], goalLimit: nums[2],
    kickerCooldownSec: nums[3], empCooldownSec: nums[4],
    winCondition: selects[0], lightingMode: selects[1],
    suddenDeathOnTie: toggles[0], autoPauseOnDisconnect: toggles[1],
    kickerEnabled: toggles[2], empEnabled: toggles[3],
    confettiOnGoal: toggles[4], arenaShakeOnGoal: toggles[5], ledSweepInIntense: toggles[6],
    goalSound: toggles[7], intenseModeMusic: toggles[8], matchEndMusic: toggles[9],
    masterVolume: range ? Number(range.value) : undefined,
  };
}

async function loadSettingsFromBackend() {
  try {
    const response = await api.getSettings();
    const settings = response?.settings ?? response;
    if (!settings) throw new Error('Settings not received from backend');
    const screen = document.getElementById('screen-settings');
    if (!screen) return;

    const nums = [...screen.querySelectorAll('input[type="number"]')];
    const keys = ['matchDurationMin','intenseModeTriggerSec','goalLimit','kickerCooldownSec','empCooldownSec'];
    keys.forEach((k, i) => { if (nums[i]) nums[i].value = settings[k]; });

    const selects = [...screen.querySelectorAll('select')];
    if (selects[0]) selects[0].value = settings.winCondition;
    if (selects[1]) selects[1].value = settings.lightingMode;

    const boolKeys = ['suddenDeathOnTie','autoPauseOnDisconnect','kickerEnabled','empEnabled',
      'confettiOnGoal','arenaShakeOnGoal','ledSweepInIntense','goalSound','intenseModeMusic','matchEndMusic'];
    const switches = [...screen.querySelectorAll('.switch')];
    switches.forEach((sw, i) => sw.classList.toggle('on', Boolean(settings[boolKeys[i]])));

    const range = screen.querySelector('input[type="range"]');
    if (range && settings.masterVolume !== undefined) range.value = settings.masterVolume;
    console.log('[settings] loaded from backend', settings);
  } catch (error) {
    console.error('[settings] failed to load:', error);
  }
}

async function saveSettingsToBackend() {
  try {
    const payload = collectSettingsPayload();
    const response = await api.saveSettings(payload);
    console.log('[settings] saved successfully:', response?.settings ?? response);
    alert('Settings saved successfully.');
  } catch (error) {
    console.error('[settings] save failed:', error);
    alert('Failed to save settings. Check the server.');
  }
}

function setupSettingsBackend() {
  const screen = document.getElementById('screen-settings');
  if (!screen) return;
  const saveButton = screen.querySelector('button');
  if (saveButton?.textContent.trim().toLowerCase().includes('save settings')) {
    saveButton.addEventListener('click', saveSettingsToBackend);
  }
}
