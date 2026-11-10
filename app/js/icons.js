// 24x24 outline icons, inlined so nothing loads at runtime.
var Icon = (function () {
  var P = {
    home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    library: '<path d="M4 3v18M9 3v18M14 4l5 16.5"/>',
    store: '<path d="M4 9h16l-1.2 11H5.2zM8 9V7a4 4 0 0 1 8 0v2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor" stroke="none"/>',
    next: '<path d="M5 5v14l10-7zM18 5v14" fill="currentColor"/>',
    prev: '<path d="M19 5v14L9 12zM6 5v14" fill="currentColor"/>',
    shuffle: '<path d="M3 7h3.5c5 0 6 10 11 10H21M3 17h3.5c2 0 3.3-1.6 4.3-3.6M13.2 9.6C14.2 8.1 15.4 7 17.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3"/>',
    repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3"/>',
    heart: '<path d="M12 20s-7.5-4.6-9-9.3C1.9 7.2 4.2 4 7.5 4c2 0 3.5 1.1 4.5 2.6C13 5.1 14.5 4 16.5 4c3.3 0 5.6 3.2 4.5 6.7C19.5 15.4 12 20 12 20z"/>',
    heartFill: '<path d="M12 20s-7.5-4.6-9-9.3C1.9 7.2 4.2 4 7.5 4c2 0 3.5 1.1 4.5 2.6C13 5.1 14.5 4 16.5 4c3.3 0 5.6 3.2 4.5 6.7C19.5 15.4 12 20 12 20z" fill="currentColor"/>',
    lyrics: '<path d="M14 4.5a5 5 0 1 1 5.5 5.5M9.5 9.5 3 18l3 3 8.5-6.5M14.5 9.5l-5 5"/>',
    queue: '<path d="M3 6h13M3 12h13M3 18h8M17 15v6l5-3z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    back: '<path d="M15 5 8 12l7 7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
    volume: '<path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>'
  };
  return function (name, size) {
    var s = size || 28;
    return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>';
  };
})();
