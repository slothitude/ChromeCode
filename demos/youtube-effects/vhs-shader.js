// VHS / Chromatic Aberration Shader
// Chromatic aberration, wavy distortion, vignette, scanlines

(function() {
  var v4 = document.querySelector("video");
  v4.style.opacity = "0";
  document.querySelectorAll("canvas[data-gl]").forEach(function(c){ c.remove(); });
  var glC4 = document.createElement("canvas");
  glC4.width = v4.videoWidth || 640;
  glC4.height = v4.videoHeight || 360;
  glC4.setAttribute("data-gl", "4");
  glC4.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:33%;height:auto;z-index:99999999;border-radius:8px;";
  document.body.appendChild(glC4);
  var gl4 = glC4.getContext("webgl");
  var vsSrc4 = ["attribute vec2 a_pos;","attribute vec2 a_tex;","varying vec2 v_tex;","void main() {","  gl_Position = vec4(a_pos, 0.0, 1.0);","  v_tex = a_tex;","}"].join("\n");
  var fsSrc4 = ["precision mediump float;","varying vec2 v_tex;","uniform sampler2D u_vid;","uniform float u_time;","","void main() {","  vec2 uv = v_tex;","  uv.x += sin(uv.y * 15.0 + u_time * 2.0) * 0.03;","  uv.y += cos(uv.x * 15.0 + u_time * 1.5) * 0.02;","  float chr = 0.008;","  float r = texture2D(u_vid, uv + vec2(chr, 0.0)).r;","  float g = texture2D(u_vid, uv).g;","  float b = texture2D(u_vid, uv - vec2(chr, 0.0)).b;","  float vig = 1.0 - smoothstep(0.5, 1.5, length(uv - 0.5) * 2.0);","  float scan = sin(uv.y * 500.0) * 0.03;","  gl_FragColor = vec4(vec3(r, g, b) * vig - scan, 1.0);","}"].join("\n");
  function mkS4(type, src) { var s = gl4.createShader(type); gl4.shaderSource(s, src); gl4.compileShader(s); return s; }
  var prog4 = gl4.createProgram();
  gl4.attachShader(prog4, mkS4(gl4.VERTEX_SHADER, vsSrc4));
  gl4.attachShader(prog4, mkS4(gl4.FRAGMENT_SHADER, fsSrc4));
  gl4.linkProgram(prog4); gl4.useProgram(prog4);
  var buf4 = gl4.createBuffer(); gl4.bindBuffer(gl4.ARRAY_BUFFER, buf4);
  gl4.bufferData(gl4.ARRAY_BUFFER, new Float32Array([-1,-1,0,1, 1,-1,1,1, -1,1,0,0, 1,1,1,0]), gl4.STATIC_DRAW);
  var aP4 = gl4.getAttribLocation(prog4, "a_pos"); var aT4 = gl4.getAttribLocation(prog4, "a_tex");
  gl4.enableVertexAttribArray(aP4); gl4.vertexAttribPointer(aP4, 2, gl4.FLOAT, false, 16, 0);
  gl4.enableVertexAttribArray(aT4); gl4.vertexAttribPointer(aT4, 2, gl4.FLOAT, false, 16, 8);
  var tex4 = gl4.createTexture(); gl4.bindTexture(gl4.TEXTURE_2D, tex4);
  gl4.texParameteri(gl4.TEXTURE_2D, gl4.TEXTURE_WRAP_S, gl4.CLAMP_TO_EDGE);
  gl4.texParameteri(gl4.TEXTURE_2D, gl4.TEXTURE_WRAP_T, gl4.CLAMP_TO_EDGE);
  gl4.texParameteri(gl4.TEXTURE_2D, gl4.TEXTURE_MIN_FILTER, gl4.LINEAR);
  gl4.texParameteri(gl4.TEXTURE_2D, gl4.TEXTURE_MAG_FILTER, gl4.LINEAR);
  gl4.uniform1i(gl4.getUniformLocation(prog4, "u_vid"), 0);
  var uT4 = gl4.getUniformLocation(prog4, "u_time"); var t04 = performance.now();
  function render4() {
    gl4.activeTexture(gl4.TEXTURE0); gl4.bindTexture(gl4.TEXTURE_2D, tex4);
    gl4.texImage2D(gl4.TEXTURE_2D, 0, gl4.RGBA, gl4.RGBA, gl4.UNSIGNED_BYTE, v4);
    gl4.uniform1f(uT4, (performance.now() - t04) / 1000.0);
    gl4.drawArrays(gl4.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render4);
  }
  render4();
})();
