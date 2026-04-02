// Schedule display - dual-track timeline program guide
// Music slots run continuously (each fills until the next music slot).
// Podcast slots are point-in-time markers (start time only, no fill).
(function() {
  'use strict';

  var DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var PX_PER_MINUTE = 1.6;
  var MIN_BLOCK_HEIGHT = 28;
  var PODCAST_BLOCK_HEIGHT = 30;

  function parseTime(timeStr) {
    var h = parseInt(timeStr.substring(0, 2), 10);
    var m = parseInt(timeStr.substring(2, 4), 10);
    return h * 60 + m;
  }

  function formatTime(timeStr) {
    return timeStr.substring(0, 2) + ':' + timeStr.substring(2, 4);
  }

  function minutesToTime(mins) {
    var h = Math.floor(mins / 60) % 24;
    var m = mins % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // Music: each slot runs until the next one starts
  function buildMusicBlocks(schedule, dayEndMin) {
    var entries = [];
    for (var time in schedule) {
      entries.push({ time: time, name: schedule[time] });
    }
    entries.sort(function(a, b) { return parseTime(a.time) - parseTime(b.time); });

    var blocks = [];
    for (var i = 0; i < entries.length; i++) {
      var start = parseTime(entries[i].time);
      var end = (i + 1 < entries.length) ? parseTime(entries[i + 1].time) : dayEndMin;
      blocks.push({
        time: entries[i].time,
        name: entries[i].name,
        startMin: start,
        endMin: end
      });
    }
    return blocks;
  }

  // Podcasts: just start times, fixed-height markers
  function buildPodcastMarkers(schedule) {
    var entries = [];
    for (var time in schedule) {
      entries.push({ time: time, name: schedule[time] });
    }
    entries.sort(function(a, b) { return parseTime(a.time) - parseTime(b.time); });
    return entries.map(function(e) {
      return { time: e.time, name: e.name, startMin: parseTime(e.time) };
    });
  }

  function renderMusicBlocks(blocks, windowStart, windowEnd, currentMinutes) {
    var html = '';
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.endMin <= windowStart || b.startMin >= windowEnd) continue;
      var clampStart = Math.max(b.startMin, windowStart);
      var clampEnd = Math.min(b.endMin, windowEnd);
      var top = (clampStart - windowStart) * PX_PER_MINUTE;
      var height = Math.max((clampEnd - clampStart) * PX_PER_MINUTE, MIN_BLOCK_HEIGHT);
      // Don't overflow past the track
      height = Math.min(height, (windowEnd - clampStart) * PX_PER_MINUTE);
      var isCurrent = currentMinutes !== null && b.startMin <= currentMinutes && b.endMin > currentMinutes;
      var cls = 'tl-block tl-music' + (isCurrent ? ' tl-current' : '');

      html += '<div class="' + cls + '" style="top:' + top + 'px;height:' + height + 'px">';
      html += '<span class="tl-block-time">' + formatTime(b.time) + '</span>';
      html += '<span class="tl-block-name">' + b.name + '</span>';
      html += '</div>';
    }
    return html;
  }

  function renderPodcastMarkers(markers, windowStart, windowEnd) {
    var html = '';
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      if (m.startMin < windowStart || m.startMin >= windowEnd) continue;
      var top = (m.startMin - windowStart) * PX_PER_MINUTE;
      // Fade: stretch to next podcast or cap at 60min, but never past windowEnd
      var nextStart = (i + 1 < markers.length) ? markers[i + 1].startMin : windowEnd;
      var fadeEnd = Math.min(nextStart, m.startMin + 60, windowEnd);
      var height = Math.max((fadeEnd - m.startMin) * PX_PER_MINUTE, MIN_BLOCK_HEIGHT);
      // Also clamp total so block doesn't overflow the track
      height = Math.min(height, (windowEnd - m.startMin) * PX_PER_MINUTE);

      html += '<div class="tl-block tl-podcast" style="top:' + top + 'px;height:' + height + 'px">';
      html += '<span class="tl-block-time">' + formatTime(m.time) + '</span>';
      html += '<span class="tl-block-name">' + m.name + '</span>';
      html += '</div>';
    }
    return html;
  }

  function renderHourMarkers(windowStart, windowEnd, step) {
    var html = '';
    var firstHour = Math.ceil(windowStart / 60);
    var lastHour = Math.floor(windowEnd / 60);
    for (var h = firstHour; h <= lastHour; h++) {
      if (step && h % step !== 0) continue;
      var pos = (h * 60 - windowStart) * PX_PER_MINUTE;
      html += '<div class="tl-hour" style="top:' + pos + 'px">';
      html += '<span class="tl-hour-label">' + (h < 10 ? '0' : '') + h + ':00</span>';
      html += '</div>';
    }
    return html;
  }

  function renderNowLine(windowStart, windowEnd, currentMinutes) {
    if (currentMinutes === null || currentMinutes < windowStart || currentMinutes > windowEnd) return '';
    var pos = (currentMinutes - windowStart) * PX_PER_MINUTE;
    return '<div class="tl-now" style="top:' + pos + 'px">' +
      '<span class="tl-now-time">' + minutesToTime(currentMinutes) + '</span>' +
      '<div class="tl-now-rule"></div>' +
      '</div>';
  }

  function renderDualTrack(musicData, podcastData, windowStart, windowEnd, currentMinutes, hourStep) {
    var musicBlocks = buildMusicBlocks(musicData, 24 * 60);
    var podcastMarkers = buildPodcastMarkers(podcastData);
    var trackHeight = (windowEnd - windowStart) * PX_PER_MINUTE;

    var html = '<div class="tl-dual" style="height:' + trackHeight + 'px">';

    // Hour markers + now line
    html += '<div class="tl-markers">';
    html += renderHourMarkers(windowStart, windowEnd, hourStep);
    html += renderNowLine(windowStart, windowEnd, currentMinutes);
    html += '</div>';

    // Music lane
    html += '<div class="tl-lane tl-lane-music">';
    html += '<div class="tl-lane-header">Musiikki</div>';
    html += renderMusicBlocks(musicBlocks, windowStart, windowEnd, currentMinutes);
    html += '</div>';

    // Podcast lane
    html += '<div class="tl-lane tl-lane-podcast">';
    html += '<div class="tl-lane-header">Podcastit</div>';
    html += renderPodcastMarkers(podcastMarkers, windowStart, windowEnd);
    html += '</div>';

    html += '</div>';
    return html;
  }

  // Find the current and next entry from a sorted block/marker list
  function findCurrentAndNext(blocks, currentMinutes) {
    var current = null;
    var next = null;
    for (var i = 0; i < blocks.length; i++) {
      var start = parseTime(blocks[i].time);
      var end = (i + 1 < blocks.length) ? parseTime(blocks[i + 1].time) : 24 * 60;
      if (start <= currentMinutes && end > currentMinutes) {
        current = blocks[i];
        if (i + 1 < blocks.length) next = blocks[i + 1];
      } else if (start > currentMinutes && !next) {
        next = blocks[i];
      }
    }
    return { current: current, next: next };
  }

  // Mobile: compact two-row layout
  function renderUpcomingMobile(container, programData) {
    var now = new Date();
    var currentMinutes = now.getHours() * 60 + now.getMinutes();
    var dayKey = DAY_KEYS[now.getDay()];

    var musicEntries = [];
    var m = programData.music[dayKey] || {};
    for (var t in m) musicEntries.push({ time: t, name: m[t] });
    musicEntries.sort(function(a, b) { return parseTime(a.time) - parseTime(b.time); });

    var podcastEntries = [];
    var p = programData.podcasts[dayKey] || {};
    for (var t2 in p) podcastEntries.push({ time: t2, name: p[t2] });
    podcastEntries.sort(function(a, b) { return parseTime(a.time) - parseTime(b.time); });

    var mus = findCurrentAndNext(musicEntries, currentMinutes);
    var pod = findCurrentAndNext(podcastEntries, currentMinutes);

    var html = '<div class="sched-compact">';

    // Row 0: title for the section
    html += '<div class="next-up-title">';
    html += '<span>Ohjelmassa lähitunteina</span>';
    html += '</div>'

    // Row 1: music now → next
    html += '<div class="sched-prog-info">Musiikkia:</div>';
    html += '<div class="sched-row">';
    if (mus.current) {
      html += '<span class="sched-now">' + mus.current.name + '</span>';
    }
    if (mus.next) {
      html += '<span class="sched-arrow">&rsaquo;</span>';
      html += '<span class="sched-upcoming">' + formatTime(mus.next.time) + ' ' + mus.next.name + '</span>';
    }
    html += '</div>';

    // Row 2: podcast now → next
    html += '<div class="sched-prog-info">Podcasteja:</div>'
    html += '<div class="sched-row sched-row-pod">';
    if (pod.current) {
      html += '<span class="sched-now">' + pod.current.name + '</span>';
    }
    if (pod.next) {
      html += '<span class="sched-arrow">&rsaquo;</span>';
      html += '<span class="sched-upcoming">' + formatTime(pod.next.time) + ' ' + pod.next.name + '</span>';
    }
    html += '</div>';

    html += '</div>';

    container.innerHTML = '';
    container.insertAdjacentHTML('beforeend', html);
    container.style.display = 'block';
  }

  // Desktop: full dual-track timeline
  function renderUpcomingDesktop(container, programData) {
    var now = new Date();
    var currentMinutes = now.getHours() * 60 + now.getMinutes();
    var dayKey = DAY_KEYS[now.getDay()];

    var windowStart = Math.floor(currentMinutes / 60) * 60;
    var windowEnd = Math.min(24 * 60, Math.ceil((currentMinutes + 240) / 60) * 60);

    var html = '<div class="schedule-widget">';
    html += '<h3 class="schedule-heading">Ohjelmakartta</h3>';

    html += renderDualTrack(
      programData.music[dayKey] || {},
      programData.podcasts[dayKey] || {},
      windowStart, windowEnd, currentMinutes, null
    );

    html += '</div>';

    container.insertAdjacentHTML('beforeend', html);
    container.style.display = 'block';
  }

  // ── Player page: upcoming schedule ──
  function renderUpcoming(container, programData) {
    renderUpcomingMobile(container, programData);
    renderUpcomingDesktop(container, programData);
  }

  var DAY_NAMES = {
    mon: 'Maanantai', tue: 'Tiistai', wed: 'Keskiviikko',
    thu: 'Torstai', fri: 'Perjantai', sat: 'Lauantai', sun: 'Sunnuntai'
  };

  var activeGuideDay = null;

  // ── Guide overlay: render a single day ──
  function renderGuideDay(dayKey, programData) {
    var now = new Date();
    var currentMinutes = now.getHours() * 60 + now.getMinutes();
    var todayKey = DAY_KEYS[now.getDay()];
    var isToday = (dayKey === todayKey);

    var trackEl = document.getElementById('guide-active-track');
    var nameEl = document.getElementById('guide-active-day-name');
    var dayEl = document.getElementById('guide-active-day');
    if (!trackEl || !nameEl || !dayEl) return;

    var label = DAY_NAMES[dayKey] || dayKey;
    if (isToday) {
      label += ' <span class="today-marker">\u2014 t\u00e4n\u00e4\u00e4n</span>';
      dayEl.classList.add('guide-day-today');
    } else {
      dayEl.classList.remove('guide-day-today');
    }
    nameEl.innerHTML = label;

    trackEl.innerHTML = renderDualTrack(
      programData.music[dayKey] || {},
      programData.podcasts[dayKey] || {},
      0, 24 * 60, isToday ? currentMinutes : null, 2
    );

    // Update active tab
    var tabs = document.querySelectorAll('.guide-tab[data-tab]');
    for (var t = 0; t < tabs.length; t++) {
      var tab = tabs[t];
      tab.classList.toggle('tab-active', tab.getAttribute('data-tab') === dayKey);
      tab.classList.toggle('tab-today', tab.getAttribute('data-tab') === todayKey);
    }

    activeGuideDay = dayKey;
  }

  function initGuideTabs(programData) {
    var tabs = document.querySelectorAll('.guide-tab[data-tab]');
    for (var t = 0; t < tabs.length; t++) {
      tabs[t].addEventListener('click', function(e) {
        e.preventDefault();
        renderGuideDay(this.getAttribute('data-tab'), programData);
      });
    }
  }

  // ── Overlay open / close ──
  var guideInitialized = false;

  window.openGuide = function() {
    var overlay = document.getElementById('guide-overlay');
    if (!overlay) return;
    overlay.classList.add('guide-open');
    document.body.style.overflow = 'hidden';

    if (!window.PROGRAM_DATA) return;

    if (!guideInitialized) {
      initGuideTabs(window.PROGRAM_DATA);
      guideInitialized = true;
    }

    var todayKey = DAY_KEYS[new Date().getDay()];
    renderGuideDay(activeGuideDay || todayKey, window.PROGRAM_DATA);

    const playerBar = document.getElementById('player-bar');
    playerBar.classList.remove('player-bar--visible');
  };

  window.closeGuide = function() {
    var overlay = document.getElementById('guide-overlay');
    if (!overlay) return;
    overlay.classList.remove('guide-open');
    document.body.style.overflow = '';

    const playerBar = document.getElementById('player-bar');
    playerBar.classList.add('player-bar--visible');
  };

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') window.closeGuide();
  });

  // ── Init ──
  // Run immediately — on first load the DOM is ready (script is at end of body),
  // and on SPA navigation the router re-executes this script after swapping content.
  if (window.PROGRAM_DATA) {
    var upcoming = document.getElementById('upcoming-schedule');
    if (upcoming) {
      renderUpcoming(upcoming, window.PROGRAM_DATA);
      setInterval(function() { renderUpcoming(upcoming, window.PROGRAM_DATA); }, 60000);
    }
  }
})();
