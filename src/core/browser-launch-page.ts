/** Served as an external script under the loopback page's strict CSP. */
export const browserLaunchScript = String.raw`
(() => {
  const state = document.getElementById('state');
  const recovery = document.getElementById('recovery');
  const retry = document.getElementById('retry');
  const version = document.getElementById('extension-version');
  let phase = 'waiting';
  let detected = '';
  let timeout;
  const errors = {
    'worker-unavailable': '扩展已检测到，但后台没有响应。请在扩展管理页重新加载墨稿，再刷新此页。',
    'tab-changed': '发布页面已经变化，已停止打开。请回到墨稿重新点击发布。',
    'open-failed': '扩展已连接，但未能打开发送窗口。请点击“重新连接”；仍失败时重新加载扩展。'
  };
  const showRecovery = (message) => {
    state.textContent = message;
    recovery.hidden = false;
  };
  const armTimeout = () => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => {
      if (phase === 'error') return;
      showRecovery(detected
        ? '已检测到扩展 ' + detected + '，但发送窗口尚未打开。可以重新连接，或点击工具栏的墨稿图标继续。'
        : '尚未连接到墨稿发布助手。已安装扩展也可能因旧版未生效、未启用或网站权限受限而没有响应。');
    }, 8000);
  };
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || !event.data || event.data.type !== 'mogao-extension-ready') return;
    const message = event.data;
    detected = typeof message.version === 'string' && /^\d+(\.\d+){2,3}$/.test(message.version) ? message.version : '（版本未知）';
    version.textContent = '已检测到扩展 ' + detected;
    phase = message.state || 'opening';
    if (phase === 'error') {
      window.clearTimeout(timeout);
      showRecovery(Object.hasOwn(errors, message.error) ? errors[message.error] : '扩展连接失败，请重新连接或重新加载扩展。');
    } else {
      state.textContent = phase === 'opening' ? '扩展已连接，正在打开发送窗口…' : '已检测到扩展，正在连接后台…';
      recovery.hidden = true;
      armTimeout();
    }
  });
  retry.addEventListener('click', () => {
    phase = 'waiting';
    recovery.hidden = true;
    state.textContent = '正在重新连接墨稿发布助手…';
    window.postMessage({ type: 'mogao-launch-retry' }, location.origin);
    armTimeout();
  });
  // Recover if the content script announced itself before this script was ready.
  window.postMessage({ type: 'mogao-launch-probe' }, location.origin);
  armTimeout();
})();
`;
