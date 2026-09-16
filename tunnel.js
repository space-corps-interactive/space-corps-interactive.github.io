import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.2/build/three.module.js";
import gsap from "https://cdn.jsdelivr.net/npm/gsap@3.13.0/+esm";

let tunnelRunning = false;
let animationFrame = null;
let renderer;
let tunnelCanvas;
const clock = new THREE.Clock();

// Config
const SEG = 420;
const HW = 3.2;
const HH = 3.2;
const GAP = 0;
const STATIONS = 30;
const RING_RADIUS = 92;

const params = {
	speed: 0.0045,
	cell: 0.8,
	gridIntensity: 0.5,
	floorReflect: 0.32,
	mouseAmp: 0.12,
	fadeFar: 58,
	panelFar: 64,
};

// Scene & Camera Setup
const scene = new THREE.Scene();
// scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
	60,
	window.innerWidth / window.innerHeight,
	0.1,
	160
);

tunnelCanvas = document.createElement("canvas");
tunnelCanvas.className = "webgl";

// Replace the renderer initialization around line 43
renderer = new THREE.WebGLRenderer({
	canvas: tunnelCanvas,
	antialias: true,
	alpha: true, // Enable transparency
});

renderer.setClearColor(0x000000, 0); // Set background clear color to fully transparent
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Dynamic UI Card Overlay for Panel Focus View
let cardElem = document.querySelector(".tunnel-card");
if (!cardElem) {
	cardElem = document.createElement("div");
	cardElem.className = "tunnel-card";
	cardElem.style.position = "fixed";
	cardElem.style.bottom = "30px";
	cardElem.style.left = "50%";
	cardElem.style.transform = "translateX(-50%) translateY(20px)";
	cardElem.style.opacity = "0";
	cardElem.style.pointerEvents = "none";
	cardElem.style.transition = "opacity 0.5s ease, transform 0.5s ease";
	cardElem.style.background = "rgba(4, 7, 13, 0.85)";
	cardElem.style.border = "1px solid rgba(111, 212, 255, 0.4)";
	cardElem.style.padding = "12px 24px";
	cardElem.style.borderRadius = "8px";
	cardElem.style.color = "#6fd4ff";
	cardElem.style.fontFamily = "sans-serif";
	cardElem.style.cursor = "pointer";
	cardElem.style.zIndex = "1000";
	document.body.appendChild(cardElem);
}

function showCard(title) {
	cardElem.innerText = title;
	cardElem.style.pointerEvents = "auto";
	cardElem.style.opacity = "1";
	cardElem.style.transform = "translateX(-50%) translateY(0px)";
}

function hideCard() {
	cardElem.style.pointerEvents = "none";
	cardElem.style.opacity = "0";
	cardElem.style.transform = "translateX(-50%) translateY(20px)";
}

// Global Control Methods
window.resizeTunnel = function (width, height) {
	if (renderer && camera) {
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setSize(width, height, false);

		camera.aspect = width / height;
		camera.fov = camera.aspect < 0.75 ? 70 : 60;
		camera.updateProjectionMatrix();
	}
};

window.mountTunnel = function (target) {
	if (!target) return;
	if (!tunnelCanvas.parentElement || tunnelCanvas.parentElement !== target) {
		target.appendChild(tunnelCanvas);
	}
	window.resizeTunnel(
		target.clientWidth || window.innerWidth,
		target.clientHeight || window.innerHeight
	);
};

window.initTunnel = function () {
	if (tunnelRunning) return;
	tunnelRunning = true;
	clock.start();
	tick();
};

window.destroyTunnel = function () {
	tunnelRunning = false;
	if (animationFrame) {
		cancelAnimationFrame(animationFrame);
		animationFrame = null;
	}
};

let seed = 20260725;
function rand() {
	seed = (seed * 1664525 + 1013904223) % 4294967296;
	return seed / 4294967296;
}

// Camino / Path Geometry
const pathPoints = [];
const RING_POINTS = 24;
for (let i = 0; i < RING_POINTS; i++) {
	const a = (i / RING_POINTS) * Math.PI * 2;
	const r =
		RING_RADIUS * (1 + Math.sin(a * 3) * 0.14 + (rand() - 0.5) * 0.06);
	pathPoints.push(
		new THREE.Vector3(
			Math.cos(a) * r,
			Math.sin(a * 2) * 7 + Math.sin(a * 5) * 2.5,
			Math.sin(a) * r
		)
	);
}
const curve = new THREE.CatmullRomCurve3(pathPoints, true, "catmullrom", 0.5);
curve.arcLengthDivisions = 4000;
const totalLength = curve.getLength();
const frames = curve.computeFrenetFrames(SEG, true);
const ringPoints = [];
for (let i = 0; i <= SEG; i++)
	ringPoints.push(curve.getPointAt((i % SEG) / SEG));

const cellV = totalLength / Math.round(totalLength / params.cell);

// Tunnel Construction
const HWi = HW * (1 - GAP);
const HHi = HH * (1 - GAP);
const FACES = [
	{ off: [HW, 0], a: [0, -HHi], b: [0, HHi] },
	{ off: [-HW, 0], a: [0, -HHi], b: [0, HHi] },
	{ off: [0, HH], a: [-HWi, 0], b: [HWi, 0] },
	{ off: [0, -HH], a: [-HWi, 0], b: [HWi, 0] },
];

function buildTunnel() {
	const pos = [];
	const uv = [];
	const edge = [];
	const idx = [];
	const tmp = new THREE.Vector3();

	FACES.forEach((face) => {
		const base = pos.length / 3;
		const span = Math.hypot(face.b[0] - face.a[0], face.b[1] - face.a[1]);

		for (let i = 0; i <= SEG; i++) {
			const p = ringPoints[i];
			const N = frames.normals[i % SEG];
			const B = frames.binormals[i % SEG];
			const v = (i / SEG) * totalLength;

			for (let k = 0; k < 2; k++) {
				const c = k === 0 ? face.a : face.b;
				tmp
					.copy(p)
					.addScaledVector(B, face.off[0] + c[0])
					.addScaledVector(N, face.off[1] + c[1]);
				pos.push(tmp.x, tmp.y, tmp.z);
				uv.push(k * span, v);
				edge.push(k);
			}
		}

		for (let i = 0; i < SEG; i++) {
			const a = base + i * 2;
			idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
	});

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
	geo.setAttribute("aEdge", new THREE.Float32BufferAttribute(edge, 1));
	geo.setIndex(idx);
	return geo;
}

const gridMaterial = new THREE.ShaderMaterial({
	uniforms: {
		uCellU: { value: params.cell },
		uCellV: { value: cellV },
		uColor: { value: new THREE.Color(0x8fa6c8) },
		uAccent: { value: new THREE.Color(0x6fd4ff) },
		uIntensity: { value: params.gridIntensity },
		uTime: { value: 0 },
		uFar: { value: params.fadeFar },
		uHeadV: { value: 0 },
		uLoop: { value: totalLength },
	},
	vertexShader: /* glsl */ `
		attribute float aEdge;
		varying vec2 vUv;
		varying float vEdge;
		varying float vDist;

		void main() {
			vUv = uv;
			vEdge = aEdge;
			vec4 mv = modelViewMatrix * vec4(position, 1.0);
			vDist = -mv.z;
			gl_Position = projectionMatrix * mv;
		}
	`,
	fragmentShader: /* glsl */ `
		uniform float uCellU;
		uniform float uCellV;
		uniform vec3 uColor;
		uniform vec3 uAccent;
		uniform float uIntensity;
		uniform float uTime;
		uniform float uFar;
		uniform float uHeadV;
		uniform float uLoop;

		varying vec2 vUv;
		varying float vEdge;
		varying float vDist;

		float gridLine(float x, float cell) {
			float c = x / cell;
			float d = abs(fract(c - 0.5) - 0.5) / max(fwidth(c), 1e-5);
			return 1.0 - clamp(d, 0.0, 1.0);
		}

		void main() {
			float lu = gridLine(vUv.x, uCellU);
			float lv = gridLine(vUv.y, uCellV);
			float line = max(lu, lv);

			float e = min(vEdge, 1.0 - vEdge);
			float rim = 1.0 - clamp(e / max(fwidth(vEdge), 1e-5), 0.0, 1.0);

			float wave = 0.5 + 0.5 * sin(vUv.y * 0.055 - uTime * 0.35);

			float dv = mod(vUv.y - uHeadV + uLoop * 0.5, uLoop) - uLoop * 0.5;
			float win = smoothstep(-16.0, -7.0, dv) * (1.0 - smoothstep(uFar * 0.3, uFar, dv));

			float fadeNear = smoothstep(0.6, 7.0, vDist);
			float fade = win * fadeNear;

			float a = (line * 0.8 + rim * 0.95) * uIntensity * fade;
			a *= mix(0.78, 1.12, wave);
			if (a < 0.002) discard;

			vec3 col = mix(uColor, uAccent, rim * 0.5 + wave * 0.12);
			gl_FragColor = vec4(col, a);
		}
	`,
	transparent: true,
	depthWrite: false,
	side: THREE.DoubleSide,
	blending: THREE.AdditiveBlending,
});

const tunnel = new THREE.Mesh(buildTunnel(), gridMaterial);
tunnel.frustumCulled = false;
scene.add(tunnel);

// Media & Dynamic Canvas Patterns
const IMG = (seed, w, h) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

const MEDIA = [
	{ type: "image", src: IMG("ig-a1", 900, 1200), title: "PRISM STATE" },
	{ type: "image", src: IMG("ig-a2", 1400, 900), title: "SOFT MACHINE" },
	{ type: "image", src: IMG("ig-a3", 1000, 1000), title: "NULL PORTRAIT" },
	{ type: "image", src: IMG("ig-a4", 1200, 800), title: "COLD BLOOM" },
	{ type: "image", src: IMG("ig-a5", 800, 1200), title: "SILENT INDEX" },
	{ type: "image", src: IMG("ig-a6", 1400, 1000), title: "GHOST FRAME" },
	{ type: "image", src: IMG("ig-a7", 1100, 900), title: "LATE SIGNAL" },
	{ type: "image", src: IMG("ig-a8", 900, 1400), title: "PAPER SUN" },
	{ type: "loop", src: "gen:deep", title: "DEEP SET" },
	{ type: "loop", src: "gen:cells", title: "CELL DRIFT" },
	{ type: "loop", src: "gen:flux", title: "FLUX FIELD" },
	{ type: "loop", src: "gen:scan", title: "SCAN LINES" },
	{ type: "loop", src: "gen:moire", title: "MOIRE 07" },
];

const INK = "#04070d";

function bg(ctx, w, h) {
	ctx.fillStyle = INK;
	ctx.fillRect(0, 0, w, h);
	const g = ctx.createRadialGradient(
		w / 2,
		h * 0.45,
		0,
		w / 2,
		h * 0.45,
		Math.hypot(w, h) * 0.55
	);
	g.addColorStop(0, "rgba(111,212,255,0.10)");
	g.addColorStop(1, "rgba(111,212,255,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, w, h);
}

const PATTERNS = {
	deep(ctx, w, h, t) {
		bg(ctx, w, h);
		const cx = w / 2;
		const cy = h / 2;
		const R = Math.hypot(w, h) * 0.62;
		for (let i = 0; i < 26; i++) {
			const p = (((i / 26 + t * 0.06) % 1) + 1) % 1;
			ctx.beginPath();
			ctx.arc(cx, cy, p * R, 0, Math.PI * 2);
			ctx.strokeStyle = `rgba(111,212,255,${0.55 * (1 - p)})`;
			ctx.lineWidth = 1 + (1 - p) * 2.6;
			ctx.stroke();
		}
	},
	cells(ctx, w, h, t) {
		bg(ctx, w, h);
		const n = 16;
		const cw = w / n;
		const ch = h / n;
		const m = cw * 0.16;
		for (let y = 0; y < n; y++) {
			for (let x = 0; x < n; x++) {
				const v =
					0.5 +
					0.5 *
						Math.sin(
							x * 0.9 + y * 0.6 + t * 1.3 + Math.sin(y * 1.7 - t * 0.6) * 1.2
						);
				if (v < 0.5) continue;
				ctx.fillStyle = `rgba(143,166,200,${((v - 0.5) / 0.5) * 0.72})`;
				ctx.fillRect(x * cw + m, y * ch + m, cw - m * 2, ch - m * 2);
			}
		}
	},
	flux(ctx, w, h, t) {
		bg(ctx, w, h);
		ctx.lineWidth = 2;
		for (let i = 0; i < 44; i++) {
			const y0 = (i / 44) * h;
			ctx.beginPath();
			for (let x = 0; x <= w; x += 16) {
				const y =
					y0 +
					Math.sin(x * 0.012 + t * 0.9 + i * 0.32) * 14 +
					Math.sin(x * 0.03 - t * 0.5) * 6;
				if (x === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.strokeStyle = `rgba(111,212,255,${
				0.16 + 0.26 * (0.5 + 0.5 * Math.sin(i * 0.5 + t))
			})`;
			ctx.stroke();
		}
	},
	scan(ctx, w, h, t) {
		bg(ctx, w, h);
		const sweep = ((((t * 0.18) % 1) + 1) % 1) * h;
		for (let y = 0; y < h; y += 4) {
			const d = Math.abs(y - sweep) / (h * 0.28);
			ctx.fillStyle = `rgba(143,166,200,${0.1 + 0.6 * Math.max(0, 1 - d)})`;
			ctx.fillRect(0, y, w, 1.6);
		}
		ctx.fillStyle = "rgba(111,212,255,0.14)";
		ctx.fillRect(0, sweep - 2, w, 4);
	},
	moire(ctx, w, h, t) {
		bg(ctx, w, h);
		ctx.globalCompositeOperation = "lighter";
		const R = Math.hypot(w, h);
		for (let k = 0; k < 2; k++) {
			ctx.save();
			ctx.translate(w / 2, h / 2);
			ctx.rotate((k ? -1 : 1) * (0.06 + 0.05 * Math.sin(t * 0.35 + k)));
			ctx.strokeStyle = k
				? "rgba(111,212,255,0.34)"
				: "rgba(143,166,200,0.34)";
			ctx.lineWidth = 2;
			for (let x = -R / 2; x < R / 2; x += 9) {
				ctx.beginPath();
				ctx.moveTo(x, -R / 2);
				ctx.lineTo(x, R / 2);
				ctx.stroke();
			}
			ctx.restore();
		}
		ctx.globalCompositeOperation = "source-over";
	},
};

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const imageSlots = new Map();
const loopSlots = new Map();
const loopEntries = [];

function loadMedia(entry, onAspect) {
	if (entry.type === "image") {
		let slot = imageSlots.get(entry.src);
		if (!slot) {
			slot = { aspect: 1, ready: false, waiting: [] };
			slot.texture = textureLoader.load(entry.src, (t) => {
				slot.aspect = t.image.width / t.image.height;
				slot.ready = true;
				slot.waiting.forEach((fn) => fn(slot.aspect));
				slot.waiting.length = 0;
			});
			slot.texture.colorSpace = THREE.SRGBColorSpace;
			slot.texture.anisotropy = maxAniso;
			imageSlots.set(entry.src, slot);
		}
		if (slot.ready) onAspect(slot.aspect);
		else slot.waiting.push(onAspect);
		return { texture: slot.texture };
	}

	let slot = loopSlots.get(entry.src);
	if (!slot) {
		const canvas = document.createElement("canvas");
		canvas.width = 512;
		canvas.height = 640;
		const ctx = canvas.getContext("2d");
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.minFilter = THREE.LinearFilter;
		tex.magFilter = THREE.LinearFilter;
		tex.generateMipmaps = false;
		slot = {
			src: entry.src,
			canvas,
			ctx,
			texture: tex,
			aspect: canvas.width / canvas.height,
			draw: PATTERNS[entry.src.slice(4)],
			active: true,
			panels: [],
		};
		slot.draw(ctx, canvas.width, canvas.height, 0);
		loopSlots.set(entry.src, slot);
		loopEntries.push(slot);
	}
	onAspect(slot.aspect);
	return { texture: slot.texture, loopSlot: slot };
}

const panelVertex = /* glsl */ `
	varying vec2 vUv;
	varying float vDist;

	void main() {
		vUv = uv;
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		vDist = -mv.z;
		gl_Position = projectionMatrix * mv;
	}
`;

const panelFragment = /* glsl */ `
	uniform sampler2D uMap;
	uniform vec2 uCrop;
	uniform vec3 uFrame;
	uniform float uHover;
	uniform float uReflect;
	uniform float uFar;
	uniform float uOpacity;

	varying vec2 vUv;
	varying float vDist;

	void main() {
		vec2 uv = 0.5 + (vUv - 0.5) * uCrop;
		vec3 col = texture2D(uMap, uv).rgb;

		vec2 d = min(vUv, 1.0 - vUv);
		float edge = 1.0 - smoothstep(0.0, 0.012, min(d.x, d.y));
		float halo = 1.0 - smoothstep(0.012, 0.06, min(d.x, d.y));

		col *= mix(1.0, 1.16, uHover);
		col += uFrame * edge * mix(0.22, 0.85, uHover);
		col += uFrame * halo * mix(0.03, 0.16, uHover);

		float fade = 1.0 - smoothstep(uFar * 0.55, uFar, vDist);

		if (uReflect > 0.5) {
			float a = uOpacity * fade * (1.0 - smoothstep(0.0, 0.8, vUv.y));
			if (a < 0.004) discard;
			gl_FragColor = vec4(col * 0.72, a);
		} else {
			gl_FragColor = vec4(col * fade, 1.0);
		}
	}
`;

const raycaster = new THREE.Raycaster();
const panels = [];

const WALL_FOOTPRINTS = [
	[3, 5],
	[4, 6],
	[6, 4],
	[2, 3],
	[5, 5],
	[3, 4],
	[7, 4],
];
const CAP_FOOTPRINTS = [
	[5, 3],
	[4, 4],
	[6, 4],
	[3, 2],
];

const FACE_ORDER = [0, 1];

const IMAGES = MEDIA.filter((m) => m.type === "image");
const LOOPS = MEDIA.filter((m) => m.type === "loop");

function mediaFor(i) {
	return i % 3 === 2
		? LOOPS[Math.floor(i / 3) % LOOPS.length]
		: IMAGES[(i - Math.floor(i / 3)) % IMAGES.length];
}

const CELLS_ACROSS = Math.round((2 * HW) / params.cell);
let vSlot = 0;

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _v = new THREE.Vector3();

function frameAt(t, outP, outN, outB) {
	const tt = ((t % 1) + 1) % 1;
	const f = tt * SEG;
	const i0 = Math.floor(f) % SEG;
	const i1 = (i0 + 1) % SEG;
	const k = f - Math.floor(f);
	outP.copy(curve.getPointAt(tt));
	outN.copy(frames.normals[i0]).lerp(frames.normals[i1], k).normalize();
	outB.copy(frames.binormals[i0]).lerp(frames.binormals[i1], k).normalize();
}

function surfacePoint(faceId, v, across, out) {
	frameAt(v / totalLength, _p, _n, _b);
	out.copy(_p);
	if (faceId === 0)
		out.addScaledVector(_b, HW - 0.03).addScaledVector(_n, across);
	else if (faceId === 1)
		out.addScaledVector(_b, -(HW - 0.03)).addScaledVector(_n, across);
	else if (faceId === 2)
		out.addScaledVector(_n, HH - 0.03).addScaledVector(_b, across);
	else out.addScaledVector(_n, -(HH - 0.03)).addScaledVector(_b, across);
	return out;
}

function buildPanelGeometry(faceId, v0, v1, a0, a1) {
	const wall = faceId < 2;
	const steps = Math.max(2, Math.ceil(Math.abs(v1 - v0) / (cellV * 0.34)));
	const pos = [];
	const uv = [];
	const idx = [];

	for (let j = 0; j <= steps; j++) {
		const s = j / steps;
		const v = v0 + (v1 - v0) * s;
		for (let k = 0; k < 2; k++) {
			const a = k === 0 ? a0 : a1;
			surfacePoint(faceId, v, a, _v);
			pos.push(_v.x, _v.y, _v.z);
			if (wall) uv.push(faceId === 0 ? 1 - s : s, k);
			else uv.push(faceId === 2 ? 1 - k : k, s);
		}
	}

	for (let j = 0; j < steps; j++) {
		const b = j * 2;
		idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
	geo.setIndex(idx);
	geo.computeBoundingSphere();
	return geo;
}

function makePanel(i) {
	const media = mediaFor(i);
	const faceId = FACE_ORDER[i % FACE_ORDER.length];
	const wall = faceId < 2;
	const fp = wall
		? WALL_FOOTPRINTS[Math.floor(rand() * WALL_FOOTPRINTS.length)]
		: CAP_FOOTPRINTS[Math.floor(rand() * CAP_FOOTPRINTS.length)];

	const cellsX = fp[0];
	const cellsY = fp[1];
	const cellsAlong = wall ? cellsX : cellsY;
	const cellsAcross = wall ? cellsY : cellsX;

	const totalSlots = Math.round(totalLength / cellV);
	const stride = Math.floor(totalSlots / STATIONS);
	vSlot = Math.max(vSlot, i * stride);
	const kStart = vSlot % totalSlots;
	vSlot += cellsAlong + 6 + Math.floor(rand() * 4);

	const vA = kStart * cellV + 0.01;
	const vB = (kStart + cellsAlong) * cellV - 0.01;
	const vCenter = (vA + vB) * 0.5;
	const t = (vCenter / totalLength) % 1;

	const mMax = CELLS_ACROSS - cellsAcross;
	const m = Math.max(0, Math.min(mMax, 1 + Math.floor(rand() * (mMax - 1))));
	const aA = m * params.cell - HW + 0.01;
	const aB = (m + cellsAcross) * params.cell - HW - 0.01;
	const across = (aA + aB) * 0.5;

	const w = wall ? vB - vA : aB - aA;
	const h = wall ? aB - aA : vB - vA;

	const material = new THREE.ShaderMaterial({
		uniforms: {
			uMap: { value: null },
			uCrop: { value: new THREE.Vector2(1, 1) },
			uFrame: { value: new THREE.Color(0x6fd4ff) },
			uHover: { value: 0 },
			uReflect: { value: 0 },
			uFar: { value: params.panelFar },
			uOpacity: { value: 1 },
		},
		vertexShader: panelVertex,
		fragmentShader: panelFragment,
		side: THREE.DoubleSide,
	});

	const mesh = new THREE.Mesh(
		buildPanelGeometry(faceId, vA, vB, aA, aB),
		material
	);
	mesh.frustumCulled = false;
	scene.add(mesh);

	const center = surfacePoint(faceId, vCenter, across, new THREE.Vector3());
	frameAt(t, _p, _n, _b);
	const inward = new THREE.Vector3();
	if (faceId === 0) inward.copy(_b).multiplyScalar(-1);
	else if (faceId === 1) inward.copy(_b);
	else if (faceId === 2) inward.copy(_n).multiplyScalar(-1);
	else inward.copy(_n);
	const up = wall
		? _n.clone()
		: _p
				.clone()
				.sub(curve.getPointAt((((t - 0.004) % 1) + 1) % 1))
				.normalize();

	let reflection = null;
	if (wall && params.floorReflect > 0) {
		const refMat = material.clone();
		refMat.uniforms.uMap = material.uniforms.uMap;
		refMat.uniforms.uCrop = material.uniforms.uCrop;
		refMat.uniforms.uHover = material.uniforms.uHover;
		refMat.uniforms.uReflect.value = 1;
		refMat.uniforms.uOpacity.value = params.floorReflect;
		refMat.transparent = true;
		refMat.depthWrite = false;
		reflection = new THREE.Mesh(
			buildPanelGeometry(faceId, vA, vB, -2 * HH - aA, -2 * HH - aB),
			refMat
		);
		reflection.frustumCulled = false;
		scene.add(reflection);
	}

	const panel = {
		index: i,
		mesh,
		reflection,
		material,
		media,
		faceId,
		t,
		w,
		h,
		center,
		inward,
		up,
		aspect: w / h,
		setAspect(a) {
			const panelAspect = w / h;
			const crop = material.uniforms.uCrop.value;
			if (a > panelAspect) crop.set(panelAspect / a, 1);
			else crop.set(1, a / panelAspect);
		},
	};

	const loaded = loadMedia(media, (a) => panel.setAspect(a));
	material.uniforms.uMap.value = loaded.texture;
	if (loaded.loopSlot) {
		loaded.loopSlot.panels.push(panel);
		panel.loopSlot = loaded.loopSlot;
	}

	mesh.userData.panel = panel;
	panels.push(panel);
	return panel;
}

for (let i = 0; i < STATIONS; i++) makePanel(i);

const state = {
	t: 0,
	speedMul: 1,
	focus: null,
	focusMix: 0,
	hovered: null,
	mouse: new THREE.Vector2(-2, -2),
	aim: new THREE.Vector2(0, 0),
	aimTarget: new THREE.Vector2(0, 0),
	currentIndex: -1,
};

const travelPos = new THREE.Vector3();
const travelQuat = new THREE.Quaternion();
const lookTarget = new THREE.Vector3();
const focusPos = new THREE.Vector3();
const focusQuat = new THREE.Quaternion();
const mUp = new THREE.Vector3();
const mAxis = new THREE.Vector3();
const lookMatrix = new THREE.Matrix4();
const aimQuat = new THREE.Quaternion();
const aimEuler = new THREE.Euler();
const rawQuat = new THREE.Quaternion();
const smoothQuat = new THREE.Quaternion();
let quatReady = false;
let smoothRoll = 0;

function frameIndexAt(t) {
	return ((Math.round(t * SEG) % SEG) + SEG) % SEG;
}

function normalAt(t, out) {
	const f = ((t % 1) + 1) * SEG;
	const i0 = Math.floor(f) % SEG;
	const i1 = (i0 + 1) % SEG;
	return out
		.copy(frames.normals[i0])
		.lerp(frames.normals[i1], f - Math.floor(f))
		.normalize();
}

function updateTravel(dt) {
	if (!state.focus)
		state.t = (state.t + params.speed * state.speedMul * dt) % 1;
	const t = state.t;
	travelPos.copy(curve.getPointAt(t));

	lookTarget.copy(curve.getPointAt((t + 0.022) % 1));
	normalAt(t, mUp);
	lookMatrix.lookAt(travelPos, lookTarget, mUp);
	rawQuat.setFromRotationMatrix(lookMatrix);

	if (!quatReady) {
		smoothQuat.copy(rawQuat);
		quatReady = true;
	} else {
		smoothQuat.slerp(rawQuat, 1 - Math.exp(-2.6 * dt));
	}
	travelQuat.copy(smoothQuat);

	mAxis
		.copy(frames.tangents[frameIndexAt(t)])
		.cross(frames.tangents[frameIndexAt((t + 0.02) % 1)]);
	const targetRoll = THREE.MathUtils.clamp(mAxis.dot(mUp) * 3.5, -0.1, 0.1);
	smoothRoll += (targetRoll - smoothRoll) * (1 - Math.exp(-1.8 * dt));

	aimEuler.set(state.aim.y, state.aim.x, smoothRoll, "YXZ");
	aimQuat.setFromEuler(aimEuler);
	travelQuat.multiply(aimQuat);
}

function focusTargets(panel) {
	const dist = Math.max(panel.w / camera.aspect, panel.h) * 1.25;
	focusPos.copy(panel.center).addScaledVector(panel.inward, dist);
	mUp.copy(panel.up);
	lookMatrix.lookAt(focusPos, panel.center, mUp);
	focusQuat.setFromRotationMatrix(lookMatrix);
}

function setHover(panel) {
	if (state.hovered === panel) return;
	if (state.hovered) {
		gsap.to(state.hovered.material.uniforms.uHover, {
			value: 0,
			duration: 0.5,
			ease: "power2.out",
		});
	}
	state.hovered = panel;
	if (panel) {
		gsap.to(panel.material.uniforms.uHover, {
			value: 1,
			duration: 0.45,
			ease: "power2.out",
		});
	}
}




// Panel Opening & Closing Logic
function openPanel(panel) {
	if (state.focus === panel) return;
	state.focus = panel;
	state.speedMul = 0;
	showCard(panel.media.title || "UNTITLED");

	gsap.to(state, {
		focusMix: 1,
		duration: 1.2,
		ease: "power2.inOut",
	});
}

function closePanel() {
	if (!state.focus) return;
	hideCard();

	gsap.to(state, {
		focusMix: 0,
		duration: 1.0,
		ease: "power2.inOut",
		onComplete() {
			state.focus = null;
			state.speedMul = 1;
		},
	});
}

// Click and Pointer Interactivity
let ptrDownTime = 0;
let ptrDownPos = { x: 0, y: 0 };

window.addEventListener("pointerdown", (e) => {
	ptrDownTime = performance.now();
	ptrDownPos = { x: e.clientX, y: e.clientY };
});

window.addEventListener("pointerup", (e) => {
	const dt = performance.now() - ptrDownTime;
	const dx = e.clientX - ptrDownPos.x;
	const dy = e.clientY - ptrDownPos.y;
	const dist = Math.hypot(dx, dy);

	// Detect stationary tap (under 8px movement and under 450ms duration)
	if (dist < 8 && dt < 450) {
		if (state.focus) {
			closePanel();
		} else if (state.hovered) {
			openPanel(state.hovered);
		}
	}
});

cardElem.addEventListener("click", (e) => {
	e.stopPropagation();
	closePanel();
});

window.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		closePanel();
	}
});

window.addEventListener("pointermove", (e) => {
	state.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
	state.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
	state.aimTarget.set(
		-state.mouse.x * params.mouseAmp,
		state.mouse.y * params.mouseAmp * 0.7
	);
});

window.addEventListener("resize", () => {
	if (tunnelRunning && tunnelCanvas.parentElement) {
		window.resizeTunnel(
			tunnelCanvas.parentElement.clientWidth,
			tunnelCanvas.parentElement.clientHeight
		);
	}
});

function updateLoopActivity() {
	loopEntries.forEach((slot) => {
		slot.active = slot.panels.some(
			(p) => p.center.distanceToSquared(camera.position) < 55 * 55
		);
	});
}

function updateHover() {
	if (state.focus) return;
	raycaster.setFromCamera(state.mouse, camera);
	const near = [];
	panels.forEach((p) => {
		if (
			p.mesh.visible &&
			p.center.distanceToSquared(camera.position) < 45 * 45
		)
			near.push(p.mesh);
	});
	const hits = raycaster.intersectObjects(near, false);
	setHover(hits.length ? hits[0].object.userData.panel : null);
}

const AHEAD = 0.085;
const BEHIND = 0.012;

function updatePanelVisibility() {
	let best = -1;
	let bestD = Infinity;

	panels.forEach((p) => {
		let d = p.t - state.t;
		if (d < 0) d += 1;

		const near = d < AHEAD || d > 1 - BEHIND;

		p.mesh.visible = near;

		if (p.reflection) {
			p.reflection.visible = near;
		}

		if (d < bestD) {
			bestD = d;
			best = p.index;
		}
	});

	if (state.focus) {
		best = state.focus.index;
	}

	if (best !== state.currentIndex) {
		state.currentIndex = best;
	}
}

let loopTimer = 0;
let activityTimer = 0;

function tick() {
	const dt = Math.min(clock.getDelta(), 0.05);
	const elapsed = clock.getElapsedTime();

	state.aim.lerp(state.aimTarget, 1 - Math.pow(0.001, dt));
	updateTravel(dt);

	if (state.focus || state.focusMix > 0.001) {
		if (state.focus) focusTargets(state.focus);
		camera.position.lerpVectors(travelPos, focusPos, state.focusMix);
		camera.quaternion.slerpQuaternions(
			travelQuat,
			focusQuat,
			state.focusMix
		);
	} else {
		camera.position.copy(travelPos);
		camera.quaternion.copy(travelQuat);
	}

	gridMaterial.uniforms.uTime.value = elapsed;
	gridMaterial.uniforms.uHeadV.value = state.t * totalLength;

	updatePanelVisibility();
	updateHover();

	activityTimer += dt;
	if (activityTimer > 0.4) {
		activityTimer = 0;
		updateLoopActivity();
	}

	loopTimer += dt;
	if (loopTimer > 1 / 24) {
		loopTimer = 0;
		loopEntries.forEach((slot) => {
			if (!slot.active) return;
			slot.draw(slot.ctx, slot.canvas.width, slot.canvas.height, elapsed);
			slot.texture.needsUpdate = true;
		});
	}

	renderer.render(scene, camera);
	if (tunnelRunning) {
		animationFrame = window.requestAnimationFrame(tick);
	}
}

window.__ig = { state, params, panels, loopEntries, camera, openPanel, closePanel };