import { useEffect, useRef, type ReactNode } from "react";

const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uRes.x / max(uRes.y, 1.0);
  float t = uTime * 0.45;
  float flow = sin(p.x * 2.2 + t) * cos(p.y * 1.7 - t * 0.8);
  float ripple = sin(p.x * 3.4 - p.y * 2.6 + t * 1.3);
  vec3 deep = vec3(0.015, 0.08, 0.22);
  vec3 mid = vec3(0.02, 0.28, 0.62);
  vec3 foam = vec3(0.40, 0.78, 0.95);
  float level = clamp(0.45 + flow * 0.35 + ripple * 0.2, 0.0, 1.0);
  vec3 col = mix(deep, mid, level);
  col = mix(col, foam, smoothstep(0.2, 0.85, ripple * 0.5 + 0.5) * 0.35);
  gl_FragColor = vec4(col, 1.0);
}
`;

function shader(gl: WebGLRenderingContext, type: number, source: string) {
  const item = gl.createShader(type);
  if (!item) return null;
  gl.shaderSource(item, source);
  gl.compileShader(item);
  return item;
}

export function FundoLiquido({ children, className = "" }: { children: ReactNode; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { antialias: false, alpha: false });
    if (!canvas || !gl) return;
    const program = gl.createProgram();
    const vs = shader(gl, gl.VERTEX_SHADER, VERT);
    const fs = shader(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!program || !vs || !fs) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const start = performance.now();
    let frame = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(canvas.clientWidth * ratio);
      canvas.height = Math.floor(canvas.clientHeight * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const draw = (now: number) => {
      resize();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={`login-liquido relative min-h-screen overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <span className="login-orb login-orb-a" aria-hidden="true" />
      <span className="login-orb login-orb-b" aria-hidden="true" />
      <span className="login-orb login-orb-c" aria-hidden="true" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">{children}</div>
    </div>
  );
}
