// Pitch Variation Effect
// Sweeps playbackRate between 0.5 (octave down) and 2.0 (octave up)

if (window.__pitchInterval) clearInterval(window.__pitchInterval);

var video = document.querySelector("video");
var phase = 0;
var speed = 0.02;

window.__pitchInterval = setInterval(function() {
  phase += speed;
  var t = (Math.sin(phase) + 1) / 2;
  var rate = 0.5 + (t * 1.5);
  video.playbackRate = rate;
}, 50);

// To stop: clearInterval(window.__pitchInterval); video.playbackRate = 1.0;
