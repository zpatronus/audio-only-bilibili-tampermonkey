// ==UserScript==
// @name         哔哩哔哩音频模式（按视频记忆）
// @namespace    https://github.com/zpatronus/audio-only-bilibili-tampermonkey
// @version      2.3.2
// @description  只听音频，默认关闭；按视频记忆设置，开启后隐藏视频画面。
// @match        https://www.bilibili.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.bilibili.com
// @noframes
// @license      GPL-3.0-only
// ==/UserScript==

/* SPDX-License-Identifier: GPL-3.0-only
 * Modified userscript implementation, 2026-10-06.
 * Based on the separate-stream approach of cyio/audio-only-bilibili,
 * itself based on Ashish-Bansal/audio-only-youtube. See ../LICENSE.
 * This source is distributed without warranty under GNU GPL version 3.
 */
(() => {
  'use strict';

  function route(href) {
    const url = new URL(href);
    const match = url.pathname.match(/^\/video\/(BV[\w]+|av\d+)\/?$/i);
    if (!match) return null;
    const id = match[1];
    const page = Math.max(1, Number.parseInt(url.searchParams.get('p'), 10) || 1);
    return { id, page, key: `audio-only:video:${id.toLowerCase()}`, token: `${id.toLowerCase()}:${page}` };
  }

  function api(path, signal) {
    return new Promise((resolve, reject) => {
      const request = GM_xmlhttpRequest({
        method: 'GET', url: `https://api.bilibili.com${path}`, timeout: 15000,
        onload(response) {
          if (signal.aborted) return;
          try {
            const json = JSON.parse(response.responseText);
            if (response.status !== 200 || json.code !== 0) throw new Error(json.message || `接口请求失败（HTTP ${response.status}）`);
            resolve(json.data);
          } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('网络请求失败')),
        ontimeout: () => reject(new Error('请求超时')),
        onabort: () => reject(new Error('请求已取消')),
      });
      signal.addEventListener('abort', () => { request.abort(); reject(new Error('请求已取消')); }, { once: true });
    });
  }

  const host = document.createElement('div');
  host.id = 'bilibili-audio-only';
  host.hidden = true;
  const root = host.attachShadow({ mode: 'open' });
  const css = document.createElement('style');
  // Dark Reader skips styles with this class. Only this widget manages its
  // palette; no page-wide darkreader-lock or changes to the site's theme.
  css.className = 'darkreader';
  css.textContent = `
    :host {
      all: initial; position: fixed; right: 20px; bottom: 20px;
      z-index: 2147483647; font: 13px/1.5 system-ui, sans-serif;
      --surface: #fff; --text: #242833; --muted: #686f7c;
      --line: #e5e7eb; --hover: #f3f5f7; --track: #d2d6df;
      --accent: #007fa8; --ring: #007fa8; color-scheme: light;
    }
    :host([data-theme="dark"]) {
      --surface: #202226; --text: #eef0f4; --muted: #a5acb8;
      --line: #383c44; --hover: #2c3037; --track: #565d69;
      --accent: #00a6d6; --ring: #59d2f5; color-scheme: dark;
    }
    *, *::before, *::after { box-sizing: border-box; }
    :host([data-wide="true"]) { left: 20px; right: 20px; width: auto; }
    :host([data-wide="true"]) .panel { max-width: none; }
    :host([data-wide="true"]) .details { width: 100%; max-width: none; padding: 0 20px 16px; }
    :host([data-wide="true"]) .toggle { flex: none; }
    :host([data-wide="true"]) .fold { margin-left: auto; }
    [hidden] { display: none !important; }
    :host([hidden]) { display: none !important; }
    .panel {
      background: var(--surface) !important; color: var(--text) !important;
      border: 1px solid var(--line) !important; border-radius: 16px;
      box-shadow: 0 4px 24px #0002; overflow: hidden;
      max-width: calc(100vw - 24px);
    }
    .header { display: flex; align-items: center; padding: 4px; gap: 2px; }
    button {
      font: inherit; color: inherit; border: 0; margin: 0;
      background: transparent !important; cursor: pointer;
      border-radius: 12px; -webkit-tap-highlight-color: transparent;
    }
    button:hover { background: var(--hover) !important; }
    button:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
    .toggle { display: flex; align-items: center; gap: 10px; padding: 10px 12px; flex: 1; min-height: 44px; }
    .icon { width: 18px; height: 18px; flex: none; color: var(--muted) !important; }
    .label { font-weight: 600; white-space: nowrap; }
    .track { width: 30px; height: 18px; border-radius: 10px; margin-left: 10px; background: var(--track) !important; flex: none; }
    .track::after { content: ''; display: block; width: 12px; height: 12px; margin: 3px; border-radius: 50%; background: #fff !important; transition: transform .15s; }
    .toggle[aria-checked="true"] .track { background: var(--accent) !important; }
    .toggle[aria-checked="true"] .track::after { transform: translateX(12px); }
    .fold { display: grid; place-items: center; width: 36px; height: 44px; }
    .fold svg { width: 16px; height: 16px; transition: transform .15s; }
    .fold[aria-expanded="false"] svg { transform: rotate(180deg); }
    .details { width: 304px; max-width: calc(100vw - 24px); padding: 0 12px 12px; }
    .status { color: var(--muted) !important; font-size: 12px; padding: 2px 4px 8px; overflow-wrap: anywhere; }
    .repeat { display: flex; gap: 4px; padding: 4px; margin-top: 10px; width: 240px; max-width: 100%; border: 1px solid var(--line) !important; border-radius: 12px; }
    .repeat button { flex: 1; min-height: 36px; padding: 6px 10px; color: var(--muted) !important; }
    .repeat button[aria-pressed="true"] { background: var(--hover) !important; color: var(--text) !important; font-weight: 600; }
    audio { display: none !important; }
    .controls { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 24px; align-items: center; }
    .progress, .volume { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .control-button { flex: none; width: 44px; height: 44px; display: grid; place-items: center; }
    .control-button svg { width: 20px; height: 20px; }
    input[type="range"] { flex: 1; width: 0; min-width: 0; height: 32px; margin: 0; cursor: pointer; accent-color: var(--accent); }
    input:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 4px; }
    button:disabled, input:disabled { opacity: .45; cursor: default; }
    .time, .level { flex: none; font-variant-numeric: tabular-nums; color: var(--muted) !important; font-size: 12px; white-space: nowrap; }
    .level { min-width: 4ch; text-align: right; }
    @media (max-width: 480px) {
      :host { right: 12px; bottom: 12px; }
      :host([data-wide="true"]) { left: 12px; right: 12px; }
      :host([data-wide="true"]) .details { padding: 0 10px 12px; }
      .controls { gap: 10px; } .progress, .volume { gap: 4px; }
      .control-button { width: 32px; } .time { font-size: 10px; }
    }
    @media (prefers-reduced-motion: reduce) { *, *::after { transition: none !important; } }
  `;
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('aria-label', '音频播放器');
  const header = document.createElement('div');
  header.className = 'header';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toggle';
  toggle.setAttribute('role', 'switch');
  toggle.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/></svg><span class="label"></span><span class="track" aria-hidden="true"></span>';
  toggle.querySelector('.label').textContent = '音频模式';
  const fold = document.createElement('button');
  fold.type = 'button';
  fold.className = 'fold';
  fold.setAttribute('aria-controls', 'audio-details');
  fold.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>';
  const details = document.createElement('div');
  details.id = 'audio-details';
  details.className = 'details';
  const status = document.createElement('div');
  status.className = 'status';
  status.setAttribute('role', 'status');
  const audio = document.createElement('audio');
  audio.controls = false;
  audio.preload = 'none';
  audio.hidden = true;
  const controls = document.createElement('div');
  controls.className = 'controls';
  controls.hidden = true;
  controls.innerHTML = '<div class="progress"><button type="button" class="control-button play" aria-label="播放"></button><input class="seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="播放进度"><span class="time">0:00 / 0:00</span></div><div class="volume"><button type="button" class="control-button mute" aria-label="静音"></button><input class="volume-slider" type="range" min="0" max="1" step="0.01" value="1" aria-label="音量"><span class="level">100%</span></div>';
  const play = controls.querySelector('.play');
  const seek = controls.querySelector('.seek');
  const timeLabel = controls.querySelector('.time');
  const mute = controls.querySelector('.mute');
  const volume = controls.querySelector('.volume-slider');
  const level = controls.querySelector('.level');
  const icon = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const playIcon = icon('<path d="m8 5 11 7-11 7Z"/>');
  const pauseIcon = icon('<path d="M8 5v14M16 5v14"/>');
  const volumeIcon = icon('<path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15 8a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/>');
  const mutedIcon = icon('<path d="M11 5 6 9H3v6h3l5 4Z"/><path d="m16 9 5 6m0-6-5 6"/>');
  function formatTime(seconds) {
    const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor(value / 60) % 60;
    const rest = String(value % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
  }
  function updateControls() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    seek.max = String(duration);
    seek.value = String(Math.min(audio.currentTime || 0, duration));
    seek.disabled = duration <= 0;
    seek.setAttribute('aria-valuetext', `${formatTime(audio.currentTime)}，共 ${formatTime(duration)}`);
    timeLabel.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
    play.innerHTML = audio.paused ? playIcon : pauseIcon;
    play.setAttribute('aria-label', audio.paused ? '播放' : '暂停');
    play.disabled = !audio.getAttribute('src');
    const muted = audio.muted || audio.volume === 0;
    mute.innerHTML = muted ? mutedIcon : volumeIcon;
    mute.setAttribute('aria-label', muted ? '取消静音' : '静音');
    mute.setAttribute('aria-pressed', String(audio.muted));
    volume.value = String(audio.muted ? 0 : audio.volume);
    level.textContent = `${Math.round(Number(volume.value) * 100)}%`;
  }
  play.addEventListener('click', () => {
    if (audio.paused) audio.play().catch(() => render('播放失败，请重试或关闭后重新开启音频模式。'));
    else audio.pause();
  });
  seek.addEventListener('input', () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Number(seek.value);
    updateControls();
  });
  volume.addEventListener('input', () => {
    audio.volume = Number(volume.value);
    audio.muted = false;
    updateControls();
  });
  mute.addEventListener('click', () => {
    if (!audio.muted && audio.volume === 0) audio.volume = 0.5;
    else audio.muted = !audio.muted;
    updateControls();
  });
  for (const event of ['timeupdate', 'durationchange', 'loadedmetadata', 'play', 'pause', 'ended', 'volumechange', 'emptied']) audio.addEventListener(event, updateControls);
  updateControls();
  const repeat = document.createElement('div');
  repeat.className = 'repeat';
  repeat.setAttribute('role', 'group');
  repeat.setAttribute('aria-label', '音频播放方式');
  const once = document.createElement('button');
  once.type = 'button';
  once.textContent = '播放一次';
  const loop = document.createElement('button');
  loop.type = 'button';
  loop.textContent = '单曲循环';
  repeat.append(once, loop);
  function setRepeat(enabled) {
    audio.loop = enabled;
    once.setAttribute('aria-pressed', String(!enabled));
    loop.setAttribute('aria-pressed', String(enabled));
  }
  function saveRepeat(enabled) {
    GM_setValue('audio-only:loop', enabled);
    setRepeat(enabled);
  }
  once.addEventListener('click', () => saveRepeat(false));
  loop.addEventListener('click', () => saveRepeat(true));
  header.append(toggle, fold);
  details.append(status, audio, controls, repeat);
  panel.append(header, details);
  root.append(css, panel);
  document.body.append(host);

  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  function updateTheme() {
    const html = document.documentElement;
    const darkReader = html.getAttribute('data-darkreader-scheme');
    const siteTheme = html.getAttribute('data-theme') || html.getAttribute('data-color-mode');
    const dark = darkReader ? darkReader === 'dark' : siteTheme ? siteTheme === 'dark' : systemTheme.matches;
    host.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  new MutationObserver(updateTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-darkreader-scheme', 'data-darkreader-mode', 'data-theme', 'data-color-mode'],
  });
  systemTheme.addEventListener('change', updateTheme);
  updateTheme();
  let collapsed = false;
  fold.addEventListener('click', () => {
    collapsed = !collapsed;
    updateDetails();
  });

  function updateDetails() {
    host.setAttribute('data-wide', String(desired && !collapsed));
    fold.hidden = !desired;
    fold.setAttribute('aria-expanded', String(!collapsed));
    fold.setAttribute('aria-label', collapsed ? '展开音频控制' : '收起音频控制');
    details.hidden = collapsed || (!desired && !status.textContent);
  }

  let current = null;
  let desired = false;
  let controller = null;
  let nativeVideo = null;
  let generation = 0;
  let busy = false;
  let failed = false;
  let restore = null;
  let hiddenPlayer = null;
  let playerDisplay = null;
  let observedPlayer = null;
  let narrowScreen = false;
  const screenObserver = new MutationObserver(() => tick());
  const suppressVideo = () => { if (nativeVideo) nativeVideo.pause(); };

  function updateScreenMode() {
    const player = document.querySelector('.bpx-player-container, .bilibili-player');
    if (player !== observedPlayer) {
      screenObserver.disconnect();
      observedPlayer = player;
      for (const node of [document.documentElement, document.body, player]) {
        if (node) screenObserver.observe(node, { attributes: true, attributeFilter: ['data-screen', 'class'] });
      }
    }
    const screen = player && player.getAttribute('data-screen');
    const alternate = '.bpx-state-wide, .bpx-state-web-fullscreen, .bpx-state-fullscreen, .mode-widescreen, .mode-webfullscreen, .mode-fullscreen';
    const pageFullscreen = document.body.classList.contains('player-fullscreen') || document.documentElement.classList.contains('player-fullscreen');
    narrowScreen = Boolean(player) && !document.fullscreenElement && !document.webkitFullscreenElement
      && (!screen || screen === 'normal') && !player.matches(alternate) && !pageFullscreen;
    host.hidden = !current || !narrowScreen;
    if (!narrowScreen && (nativeVideo || busy)) stop(true);
  }

  function hidePlayer(video) {
    // #playerWrap can also contain the video collection/playlist. Hide only
    // the dedicated player area, and never insert our UI into Vue's DOM tree.
    const player = video.closest('.bpx-player-video-area') || video.closest('.bpx-player-container') || video.closest('.bilibili-player-video') || video;
    hiddenPlayer = player;
    playerDisplay = { value: player.style.getPropertyValue('display'), priority: player.style.getPropertyPriority('display') };
    player.style.setProperty('display', 'none', 'important');
  }

  function showPlayer() {
    if (hiddenPlayer && playerDisplay) {
      if (playerDisplay.value) hiddenPlayer.style.setProperty('display', playerDisplay.value, playerDisplay.priority);
      else hiddenPlayer.style.removeProperty('display');
    }
    hiddenPlayer = null;
    playerDisplay = null;
  }

  function render(message = '') {
    panel.hidden = !current;
    host.setAttribute('data-active', String(desired));
    toggle.setAttribute('aria-checked', String(desired));
    toggle.title = desired ? '关闭此视频的音频模式' : '开启此视频的音频模式';
    status.textContent = message || (desired ? '已为此视频记住设置' : '');
    updateDetails();
  }

  function stop(resume) {
    generation += 1;
    if (controller) controller.abort();
    controller = null;
    busy = false;
    const time = audio.currentTime;
    const wasPlaying = !audio.paused;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio.hidden = true;
    controls.hidden = true;
    showPlayer();
    if (nativeVideo) {
      nativeVideo.removeEventListener('play', suppressVideo);
      if (resume && restore) {
        nativeVideo.volume = audio.volume;
        nativeVideo.muted = audio.muted;
        nativeVideo.playbackRate = audio.playbackRate;
        try { nativeVideo.currentTime = restore.started ? time : restore.time; } catch (_) { /* Not yet seekable. */ }
        if (restore.started ? wasPlaying : restore.playing) nativeVideo.play().catch(() => {});
      }
    }
    nativeVideo = null;
    restore = null;
  }

  async function start(video) {
    busy = true;
    const mine = ++generation;
    const selected = current;
    controller = new AbortController();
    const signal = controller.signal;
    render('正在获取音频…');
    try {
      const identifier = /^av/i.test(selected.id) ? `aid=${selected.id.slice(2)}` : `bvid=${encodeURIComponent(selected.id)}`;
      const info = await api(`/x/web-interface/view?${identifier}`, signal);
      const part = info.pages && info.pages[selected.page - 1];
      if (!part) throw new Error('无法获取视频分集信息');
      if (mine !== generation || signal.aborted) return;
      const play = await api(`/x/player/playurl?bvid=${encodeURIComponent(info.bvid)}&cid=${part.cid}&fnval=16&fnver=0&fourk=1`, signal);
      const streams = (play.dash && play.dash.audio || []).slice().sort((a, b) => b.bandwidth - a.bandwidth);
      const stream = streams.find(item => item.mimeType === 'audio/mp4' || item.mime_type === 'audio/mp4') || streams[0];
      const source = stream && (stream.baseUrl || stream.base_url);
      if (!source || new URL(source).protocol !== 'https:') throw new Error('未找到可播放的 DASH 音频流，该视频可能需要登录或使用了其他格式');
      if (mine !== generation || signal.aborted || !video.isConnected || !narrowScreen) return;
      nativeVideo = video;
      restore = { time: video.currentTime, playing: !video.paused, started: false };
      audio.volume = video.volume;
      audio.muted = video.muted;
      audio.playbackRate = video.playbackRate;
      video.addEventListener('play', suppressVideo);
      video.pause();
      hidePlayer(video);
      audio.onloadedmetadata = () => {
        if (mine !== generation) return;
        audio.currentTime = Math.min(restore.time, Number.isFinite(audio.duration) ? audio.duration : restore.time);
        restore.started = true;
        if (restore.playing) audio.play().catch(() => render('点击播放开始收听'));
      };
      audio.src = source;
      audio.preload = 'metadata';
      audio.hidden = false;
      controls.hidden = false;
      audio.load();
      updateControls();
      render();
    } catch (error) {
      if (mine === generation) {
        stop(true);
        failed = true;
        collapsed = false;
        render(`音频不可用：${error.message}。关闭后重新开启以重试。`);
      }
    } finally {
      if (mine === generation) busy = false;
    }
  }

  audio.addEventListener('error', () => {
    if (!nativeVideo || !audio.getAttribute('src')) return;
    stop(true);
    failed = true;
    collapsed = false;
    render('音频加载失败。关闭后重新开启以重试。');
  });

  toggle.addEventListener('click', () => {
    if (!current) return;
    desired = !desired;
    GM_setValue(current.key, desired);
    failed = false;
    stop(!desired);
    render();
    tick();
  });

  function tick() {
    const next = route(location.href);
    if ((next && next.token) !== (current && current.token)) {
      stop(false);
      current = next;
      desired = Boolean(current && GM_getValue(current.key, false));
      setRepeat(Boolean(GM_getValue('audio-only:loop', false)));
      failed = false;
      render();
    }
    updateScreenMode();
    if (!current || !narrowScreen || !desired || busy || failed) return;
    const video = document.querySelector('.bpx-player-video-wrap video, .bilibili-player-video video, #bilibili-player video');
    if (nativeVideo && nativeVideo !== video) stop(false);
    if (!nativeVideo && video) start(video);
  }
  window.addEventListener('pagehide', () => stop(false));
  document.addEventListener('fullscreenchange', tick);
  document.addEventListener('webkitfullscreenchange', tick);
  setInterval(tick, 500);
  setRepeat(Boolean(GM_getValue('audio-only:loop', false)));
  render();
  tick();
})();
