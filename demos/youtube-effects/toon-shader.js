// Toon / Cel Shader Effect
// Posterized colors with Sobel edge detection outlines

(function() {
  var v = document.querySelector("video");
  var c = document.createElement("canvas");
  c.id = "__toonCanvas";
  c.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;";
  var ct = v.closest("div") || v.parentElement;
  ct.style.position = "relative"; ct.appendChild(c);
  var g = c.getContext("webgl");
  var vs = "attribute vec2 a_pos;varying vec2 v_tex;void main(){gl_Position=vec4(a_pos,0.0,1.0);v_tex=a_pos*0.5+0.5;}";
  var fs = "precision mediump float;varying vec2 v_tex;uniform sampler2D u_vid;void main(){vec4 c=texture2D(u_vid,v_tex);float bands=5.0;vec3 toon=floor(c.rgb*bands)/bands;float ox=1.0/640.0;float oy=1.0/360.0;vec3 tl=texture2D(u_vid,v_tex+vec2(-ox,-oy)).rgb;vec3 tr=texture2D(u_vid,v_tex+vec2(ox,-oy)).rgb;vec3 bl=texture2D(u_vid,v_tex+vec2(-ox,oy)).rgb;vec3 br=texture2D(u_vid,v_tex+vec2(ox,oy)).rgb;vec3 gx=-tl+tr-bl+br;vec3 gy=-tl-tr+bl+br;float edge=length(gx)+length(gy);float outline=step(0.3,edge);toon*=(1.0-outline);gl_FragColor=vec4(toon,1.0);}";
  function mkS(t, s) { var sh = g.createShader(t); g.shaderSource(sh, s); g.compileShader(sh); return sh; }
  var p = g.createProgram();
  g.attachShader(p, mkS(g.VERTEX_SHADER, vs));
  g.attachShader(p, mkS(g.FRAGMENT_SHADER, fs));
  g.linkProgram(p); g.useProgram(p);
  var b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), g4.STATIC_DRAW);
  var a = g.getAttribLocation(p, "a_pos");
  g.enableVertexAttribArray(a); g.vertexAttribPointer(a, 2, g.FLOAT, false, 0, 0);
  var tx = g.createTexture(); g.bindTexture(g.TEXTURE_2D, tx);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  function renderToon() {
    c.width = v.videoWidth || 640; c.height = v.videoHeight || 360;
    g.viewport(0, 0, c.width, c.height);
    g.bindTexture(g.TEXTURE_2D, tx);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, v);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(renderToon);
  }
  renderToon();
})();
