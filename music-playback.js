"use strict";

// Safari/iPhoneには、MediaElementSourceへ接続した音源のplaybackRateが途切れる
// WebKit不具合がある。通常用と速度変更用のAudio要素を分け、後者はWeb Audioへ接続しない。
(() => {
  function createPlayer() {
    const player = new Audio();
    player.loop = false;
    player.preload = "metadata";
    return player;
  }
  function preservePitch(media) {
    for (const key of ["preservesPitch", "webkitPreservesPitch", "mozPreservesPitch"]) {
      if (!(key in media)) continue;
      try { media[key] = true; } catch (_) {}
    }
  }

  function hasAffectedApplePlaybackEngine(nav = navigator) {
    const ua = String(nav && nav.userAgent || "");
    const platform = String(nav && nav.platform || "");
    const touchMac = platform === "MacIntel" && Number(nav && nav.maxTouchPoints || 0) > 1;
    const ios = /iPad|iPhone|iPod/.test(ua) || touchMac;
    const safari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
    return ios || safari;
  }

  function create({ onSwitch, onResume, onUpdate } = {}) {
    const graphPlayer = createPlayer();
    const nativeRatePlayer = createPlayer();
    let current = graphPlayer;
    let switchGeneration = 0;
    const applyRate = (player, rate) => {
      preservePitch(player);
      player.defaultPlaybackRate = rate;
      player.playbackRate = rate;
      preservePitch(player);
    };
    [graphPlayer, nativeRatePlayer].forEach((player) => {
      player.addEventListener("loadedmetadata", () => preservePitch(player));
      player.addEventListener("ratechange", () => preservePitch(player));
    });
    const usesNative = (rate, partView, nav = navigator) =>
      !!partView && Math.abs(Number(rate) - 1) > 0.001 && hasAffectedApplePlaybackEngine(nav);

    function setRate(rate, partView) {
      const target = usesNative(rate, partView) ? nativeRatePlayer : graphPlayer;
      if (target === current) {
        applyRate(current, rate);
        return current;
      }
      const generation = ++switchGeneration;
      const previous = current;
      const source = previous.currentSrc || previous.src || "";
      const previousTime = Number(previous.currentTime) || 0;
      const resume = !previous.paused;
      previous.pause();
      current = target;
      if (onSwitch) onSwitch(target);

      const restore = () => {
        if (generation !== switchGeneration || current !== target) return;
        try { target.currentTime = previousTime; } catch (_) {}
        applyRate(target, rate);
        if (resume && onResume) onResume(target);
        if (onUpdate) onUpdate();
      };
      if (!source) {
        target.pause();
        target.removeAttribute("src");
        restore();
      } else if ((target.currentSrc || target.src || "") !== source) {
        target.src = source;
        target.addEventListener("loadedmetadata", restore, { once: true });
        try { target.load(); } catch (_) {}
      } else if (target.readyState >= 1) {
        restore();
      } else {
        target.addEventListener("loadedmetadata", restore, { once: true });
        try { target.load(); } catch (_) {}
      }
      return current;
    }
    function bindEvents({ onMetadata, onMediaUpdate, onPlay, onStop, onPlaying } = {}) {
      [graphPlayer, nativeRatePlayer].forEach((player) => {
        const active = (fn) => (...args) => {
          if (player === current && fn) fn(...args);
        };
        player.addEventListener("loadedmetadata", active(onMetadata));
        ["timeupdate", "loadedmetadata", "play", "pause", "ended"].forEach((event) =>
          player.addEventListener(event, active(onMediaUpdate)));
        player.addEventListener("play", active(onPlay));
        ["pause", "ended"].forEach((event) => player.addEventListener(event, active(onStop)));
        player.addEventListener("playing", active(onPlaying));
      });
    }

    return {
      graphPlayer,
      nativeRatePlayer,
      setRate,
      usesNative,
      bindEvents,
      get current() { return current; },
    };
  }

  window.RoutineMusicPlayback = { create, hasAffectedApplePlaybackEngine };
})();
