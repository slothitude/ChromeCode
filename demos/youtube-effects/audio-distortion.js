// Audio Distortion Effect
// Adds waveshaper distortion to the video audio

var video = document.querySelector("video");
var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
var source = audioCtx.createMediaElementSource(video);
var distortion = audioCtx.createWaveShaper();

function makeDistortionCurve(amount) {
  var k = typeof amount === "number" ? amount : 50;
  var n_samples = 44100;
  var curve = new Float32Array(n_samples);
  var deg = Math.PI / 180;
  for (var i = 0; i < n_samples; i++) {
    var x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

distortion.curve = makeDistortionCurve(200);
distortion.oversample = "4x";
source.connect(distortion);
distortion.connect(audioCtx.destination);
